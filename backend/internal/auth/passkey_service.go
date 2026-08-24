package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

const passkeyChallengeTTL = 5 * time.Minute

var ErrPasskeyChallenge = errors.New("passkey ceremony is invalid, expired, or already used")

type PasskeyService struct {
	db       *sql.DB
	rp       *webauthn.WebAuthn
	sessions *SessionService
}

type passkeyUser struct {
	id          string
	displayName string
	credentials []webauthn.Credential
}

func (u *passkeyUser) WebAuthnID() []byte                         { return []byte(u.id) }
func (u *passkeyUser) WebAuthnName() string                       { return u.id }
func (u *passkeyUser) WebAuthnDisplayName() string                { return u.displayName }
func (u *passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

type passkeyCeremony struct {
	Session webauthn.SessionData `json:"session"`
}

type PasskeyOptions struct {
	CeremonyToken string `json:"ceremony_token"`
	Options       any    `json:"options"`
}

type PasskeySummary struct {
	CredentialID string    `json:"credential_id"`
	CreatedAt    time.Time `json:"created_at"`
	LastUsedAt   time.Time `json:"last_used_at,omitempty"`
}

func NewPasskeyService(database *sql.DB, relyingParty *webauthn.WebAuthn, sessions *SessionService) *PasskeyService {
	return &PasskeyService{db: database, rp: relyingParty, sessions: sessions}
}

func (s *PasskeyService) BeginRegistration(ctx context.Context, userID string, now time.Time) (PasskeyOptions, error) {
	if userID == "" {
		return PasskeyOptions{}, errors.New("user ID is required")
	}
	user, err := s.loadUser(ctx, userID)
	if err != nil {
		return PasskeyOptions{}, err
	}
	creation, session, err := s.rp.BeginRegistration(user,
		webauthn.WithExclusions(webauthn.Credentials(user.credentials).CredentialDescriptors()),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationRequired,
		}),
	)
	if err != nil {
		return PasskeyOptions{}, err
	}
	return s.saveCeremony(ctx, userID, "passkey_register", session, creation, now)
}

// BeginLogin supports both usernameless discoverable login and a known-user
// login. The former is used by the app's Passkey login button; the latter is
// useful when the client already knows the service user identifier.
func (s *PasskeyService) BeginLogin(ctx context.Context, userID string, now time.Time) (PasskeyOptions, error) {
	var (
		assertion *protocol.CredentialAssertion
		session   *webauthn.SessionData
		err       error
	)
	if userID == "" {
		assertion, session, err = s.rp.BeginDiscoverableLogin(
			webauthn.WithUserVerification(protocol.VerificationRequired),
		)
	} else {
		user, loadErr := s.loadUser(ctx, userID)
		if loadErr != nil {
			return PasskeyOptions{}, loadErr
		}
		assertion, session, err = s.rp.BeginLogin(user,
			webauthn.WithUserVerification(protocol.VerificationRequired),
		)
	}
	if err != nil {
		return PasskeyOptions{}, err
	}
	return s.saveCeremony(ctx, userID, "passkey_login", session, assertion, now)
}

func (s *PasskeyService) saveCeremony(ctx context.Context, userID, kind string, session *webauthn.SessionData, options any, now time.Time) (PasskeyOptions, error) {
	token, err := randomBase64URL(32)
	if err != nil {
		return PasskeyOptions{}, err
	}
	scope, err := json.Marshal(passkeyCeremony{Session: *session})
	if err != nil {
		return PasskeyOptions{}, err
	}
	var nullableUser any
	if userID != "" {
		nullableUser = userID
	}
	created := now.UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO auth_challenges (id,user_id,type,token_hash,scope,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, newID(), nullableUser, kind, hashOAuthState(token), string(scope), now.Add(passkeyChallengeTTL).UTC().Format(time.RFC3339Nano), created)
	if err != nil {
		return PasskeyOptions{}, err
	}
	return PasskeyOptions{CeremonyToken: token, Options: options}, nil
}

func (s *PasskeyService) FinishRegistration(ctx context.Context, userID, token string, request *http.Request, now time.Time) error {
	if userID == "" || token == "" {
		return ErrPasskeyChallenge
	}
	ceremony, tx, err := s.consumeCeremony(ctx, token, "passkey_register", userID, now)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	user, err := s.loadUser(ctx, userID)
	if err != nil {
		return err
	}
	credential, err := s.rp.FinishRegistration(user, ceremony.Session, request)
	if err != nil {
		return err
	}
	encodedID := base64.RawURLEncoding.EncodeToString(credential.ID)
	credentialJSON, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `INSERT INTO passkey_credentials (id,user_id,credential_id,public_key,credential_json,sign_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, newID(), userID, encodedID, base64.RawURLEncoding.EncodeToString(credential.PublicKey), string(credentialJSON), credential.Authenticator.SignCount, created); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *PasskeyService) FinishLogin(ctx context.Context, token string, request *http.Request, now time.Time) (SessionTokens, error) {
	ceremony, tx, err := s.consumeCeremony(ctx, token, "passkey_login", "", now)
	if err != nil {
		return SessionTokens{}, err
	}
	defer tx.Rollback()

	var user *passkeyUser
	var credential *webauthn.Credential
	if len(ceremony.Session.UserID) != 0 {
		userID := string(ceremony.Session.UserID)
		user, err = s.loadUser(ctx, userID)
		if err != nil {
			return SessionTokens{}, err
		}
		credential, err = s.rp.FinishLogin(user, ceremony.Session, request)
	} else {
		var discovered webauthn.User
		discovered, credential, err = s.rp.FinishPasskeyLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
			if len(userHandle) != 0 {
				return s.loadUser(ctx, string(userHandle))
			}
			return s.loadUserByCredential(ctx, rawID)
		}, ceremony.Session, request)
		if err == nil {
			var ok bool
			user, ok = discovered.(*passkeyUser)
			if !ok {
				return SessionTokens{}, errors.New("invalid passkey user")
			}
		}
	}
	if err != nil {
		return SessionTokens{}, err
	}
	if user == nil || credential == nil {
		return SessionTokens{}, errors.New("passkey credential is missing")
	}
	credentialJSON, err := json.Marshal(credential)
	if err != nil {
		return SessionTokens{}, err
	}
	encodedID := base64.RawURLEncoding.EncodeToString(credential.ID)
	if _, err = tx.ExecContext(ctx, `UPDATE passkey_credentials SET credential_json=$1,sign_count=$2,last_used_at=$3 WHERE user_id=$4 AND credential_id=$5`, string(credentialJSON), credential.Authenticator.SignCount, now.UTC().Format(time.RFC3339Nano), user.id, encodedID); err != nil {
		return SessionTokens{}, err
	}
	if err = tx.Commit(); err != nil {
		return SessionTokens{}, err
	}
	return s.sessions.CreateSession(ctx, user.id, now)
}

func (s *PasskeyService) RemoveCredential(ctx context.Context, userID, credentialID string) error {
	if userID == "" || credentialID == "" {
		return errors.New("user ID and credential ID are required")
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM passkey_credentials WHERE user_id=$1 AND credential_id=$2`, userID, credentialID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *PasskeyService) ListCredentials(ctx context.Context, userID string) ([]PasskeySummary, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT credential_id,created_at,COALESCE(last_used_at,'') FROM passkey_credentials WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]PasskeySummary, 0)
	for rows.Next() {
		var item PasskeySummary
		var created, lastUsed string
		if err = rows.Scan(&item.CredentialID, &created, &lastUsed); err != nil {
			return nil, err
		}
		item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		if lastUsed != "" {
			item.LastUsedAt, err = time.Parse(time.RFC3339Nano, lastUsed)
			if err != nil {
				return nil, err
			}
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *PasskeyService) consumeCeremony(ctx context.Context, token, kind, userID string, now time.Time) (passkeyCeremony, *sql.Tx, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return passkeyCeremony{}, nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var storedUser sql.NullString
	var scope string
	var usedAt sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT user_id,scope,used_at FROM auth_challenges WHERE token_hash=$1 AND type=$2 AND expires_at>$3 FOR UPDATE`, hashOAuthState(token), kind, now.UTC().Format(time.RFC3339Nano)).Scan(&storedUser, &scope, &usedAt)
	if errors.Is(err, sql.ErrNoRows) || usedAt.Valid {
		return passkeyCeremony{}, nil, ErrPasskeyChallenge
	}
	if err != nil {
		return passkeyCeremony{}, nil, err
	}
	if userID != "" && (!storedUser.Valid || subtle.ConstantTimeCompare([]byte(storedUser.String), []byte(userID)) != 1) {
		return passkeyCeremony{}, nil, ErrPasskeyChallenge
	}
	var ceremony passkeyCeremony
	if err = json.Unmarshal([]byte(scope), &ceremony); err != nil {
		return passkeyCeremony{}, nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE auth_challenges SET used_at=$1 WHERE token_hash=$2`, now.UTC().Format(time.RFC3339Nano), hashOAuthState(token)); err != nil {
		return passkeyCeremony{}, nil, err
	}
	return ceremony, tx, nil
}

func (s *PasskeyService) loadUser(ctx context.Context, userID string) (*passkeyUser, error) {
	var status string
	if err := s.db.QueryRowContext(ctx, `SELECT status FROM users WHERE id=$1`, userID).Scan(&status); err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, errors.New("user is inactive")
	}
	return s.loadUserWithCredentials(ctx, userID)
}

func (s *PasskeyService) loadUserByCredential(ctx context.Context, rawID []byte) (*passkeyUser, error) {
	id := base64.RawURLEncoding.EncodeToString(rawID)
	var userID string
	if err := s.db.QueryRowContext(ctx, `SELECT user_id FROM passkey_credentials WHERE credential_id=$1`, id).Scan(&userID); err != nil {
		return nil, err
	}
	return s.loadUser(ctx, userID)
}

func (s *PasskeyService) loadUserWithCredentials(ctx context.Context, userID string) (*passkeyUser, error) {
	user := &passkeyUser{id: userID, displayName: "Samurai Meet user"}
	rows, err := s.db.QueryContext(ctx, `SELECT credential_id,public_key,credential_json,sign_count FROM passkey_credentials WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var credentialID, publicKey string
		var credentialJSON sql.NullString
		var signCount uint32
		if err = rows.Scan(&credentialID, &publicKey, &credentialJSON, &signCount); err != nil {
			return nil, err
		}
		var credential webauthn.Credential
		if credentialJSON.Valid && credentialJSON.String != "" {
			if err = json.Unmarshal([]byte(credentialJSON.String), &credential); err != nil {
				return nil, fmt.Errorf("decode passkey credential: %w", err)
			}
		} else {
			id, decodeErr := base64.RawURLEncoding.DecodeString(credentialID)
			key, keyErr := base64.RawURLEncoding.DecodeString(publicKey)
			if decodeErr != nil || keyErr != nil {
				return nil, errors.New("invalid stored passkey credential")
			}
			credential.ID = id
			credential.PublicKey = key
			credential.Authenticator.SignCount = signCount
		}
		user.credentials = append(user.credentials, credential)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return user, nil
}

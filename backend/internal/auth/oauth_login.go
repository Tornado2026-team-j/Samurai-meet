package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
)

const OAuthHandoffTTL = 10 * time.Minute

type OAuthLoginResult struct {
	UserID            string `json:"user_id"`
	PreAuthToken      string `json:"pre_auth_token"`
	PasskeyRequired   bool   `json:"passkey_required"`
	PasskeyRegistered bool   `json:"passkey_registered"`
	RecoveryAvailable bool   `json:"recovery_available"`
}
type OAuthHandoff struct{ Code, AppRedirectURI string }
type OAuthLoginService struct {
	google  *GoogleOIDC
	states  *OAuthStateStore
	db      *sql.DB
	signer  *Signer
	preauth *PreAuthService
}

func NewOAuthLoginService(google *GoogleOIDC, states *OAuthStateStore, database *sql.DB, signer *Signer, preauth ...*PreAuthService) *OAuthLoginService {
	var preAuthService *PreAuthService
	if len(preauth) > 0 {
		preAuthService = preauth[0]
	}
	return &OAuthLoginService{google: google, states: states, db: database, signer: signer, preauth: preAuthService}
}

func (s *OAuthLoginService) Start(ctx context.Context, now time.Time, appRedirectURI, handoffChallenge string) (string, error) {
	if appRedirectURI == "" || handoffChallenge == "" {
		return "", errors.New("mobile redirect URI and handoff challenge are required")
	}
	state, verifier, err := s.states.Create(ctx, now, appRedirectURI, handoffChallenge)
	if err != nil {
		return "", err
	}
	return s.google.AuthorizationURL(state, pkceChallenge(verifier)), nil
}

func (s *OAuthLoginService) Complete(ctx context.Context, code, state string, now time.Time) (OAuthHandoff, error) {
	oauthState, err := s.states.Consume(ctx, state, now)
	if err != nil {
		return OAuthHandoff{}, err
	}
	identity, err := s.google.Exchange(ctx, code, oauthState.CodeVerifier)
	if err != nil {
		return OAuthHandoff{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OAuthHandoff{}, err
	}
	defer tx.Rollback()
	created := now.UTC().Format(time.RFC3339Nano)
	candidateID := newID()
	var userID, userStatus string
	displayName := normalizedDisplayName(identity.DisplayName, identity.Email)
	err = tx.QueryRowContext(ctx, `INSERT INTO users (id,google_subject_id,status,display_name,created_at,updated_at) VALUES ($1,$2,'active',$3,$4,$4) ON CONFLICT (google_subject_id) DO UPDATE SET updated_at=EXCLUDED.updated_at,display_name=CASE WHEN users.display_name='' THEN EXCLUDED.display_name ELSE users.display_name END RETURNING id,status`, candidateID, identity.Subject, displayName, created).Scan(&userID, &userStatus)
	if err != nil {
		return OAuthHandoff{}, err
	}
	if userStatus != "active" {
		return OAuthHandoff{}, errors.New("user is not active")
	}
	handoff, err := randomBase64URL(32)
	if err != nil {
		return OAuthHandoff{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO oauth_handoffs (code_hash,user_id,code_challenge,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)`, hashOAuthState(handoff), userID, oauthState.HandoffChallenge, now.Add(OAuthHandoffTTL).UTC().Format(time.RFC3339Nano), created)
	if err != nil {
		return OAuthHandoff{}, err
	}
	if err = tx.Commit(); err != nil {
		return OAuthHandoff{}, err
	}
	return OAuthHandoff{Code: handoff, AppRedirectURI: oauthState.AppRedirectURI}, nil
}

func normalizedDisplayName(value, fallback string) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
	if value == "" {
		value = strings.Map(func(r rune) rune {
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, strings.TrimSpace(fallback))
	}
	runes := []rune(value)
	if len(runes) > 64 {
		runes = runes[:64]
	}
	if len(runes) == 0 {
		return "Samurai Meet"
	}
	return string(runes)
}

func (s *OAuthLoginService) ExchangeHandoff(ctx context.Context, handoff, verifier string, now time.Time) (OAuthLoginResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	defer tx.Rollback()
	var userID, challenge, ciphertext, nonce string
	err = tx.QueryRowContext(ctx, `SELECT user_id,code_challenge,COALESCE(response_ciphertext, ''),COALESCE(response_nonce, '') FROM oauth_handoffs WHERE code_hash=$1 AND expires_at>$2 FOR UPDATE`, hashOAuthState(handoff), now.UTC().Format(time.RFC3339Nano)).Scan(&userID, &challenge, &ciphertext, &nonce)
	if errors.Is(err, sql.ErrNoRows) {
		return OAuthLoginResult{}, errors.New("handoff is invalid or expired")
	}
	if err != nil {
		return OAuthLoginResult{}, err
	}
	if subtle.ConstantTimeCompare([]byte(challenge), []byte(pkceChallenge(verifier))) != 1 {
		return OAuthLoginResult{}, errors.New("handoff verifier mismatch")
	}
	if ciphertext != "" {
		plaintext, openErr := s.signer.Open(ciphertext, nonce)
		if openErr != nil {
			return OAuthLoginResult{}, openErr
		}
		var cached OAuthLoginResult
		if err = json.Unmarshal(plaintext, &cached); err != nil {
			return OAuthLoginResult{}, err
		}
		return cached, tx.Commit()
	}
	if s.preauth == nil {
		return OAuthLoginResult{}, errors.New("pre-auth service is not configured")
	}
	var credentialCount int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM passkey_credentials WHERE user_id=$1`, userID).Scan(&credentialCount); err != nil {
		return OAuthLoginResult{}, err
	}
	scope := PreAuthScopeRegister
	if credentialCount > 0 {
		scope = PreAuthScopeLogin
	}
	preAuthToken, err := s.preauth.IssueTx(ctx, tx, userID, scope, now)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	var recoveryAvailable bool
	if err = tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM key_envelopes
			WHERE user_id=$1
			  AND recovery_public_key IS NOT NULL
			  AND recovery_public_key <> ''
		)`, userID).Scan(&recoveryAvailable); err != nil {
		return OAuthLoginResult{}, err
	}
	result := OAuthLoginResult{
		UserID:            userID,
		PreAuthToken:      preAuthToken,
		PasskeyRequired:   true,
		PasskeyRegistered: credentialCount > 0,
		RecoveryAvailable: recoveryAvailable,
	}
	payload, err := json.Marshal(result) // #nosec G117 -- immediately encrypted for one-time handoff retry storage; never logged or returned as JSON
	if err != nil {
		return OAuthLoginResult{}, err
	}
	ciphertext, nonce, err = s.signer.Seal(payload)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE oauth_handoffs SET used_at=$1,response_ciphertext=$2,response_nonce=$3 WHERE code_hash=$4`, now.UTC().Format(time.RFC3339Nano), ciphertext, nonce, hashOAuthState(handoff)); err != nil {
		return OAuthLoginResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return OAuthLoginResult{}, err
	}
	return result, nil
}

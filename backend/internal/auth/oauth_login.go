package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

const OAuthHandoffTTL = 10 * time.Minute

type OAuthLoginResult struct {
	UserID, AccessToken, RefreshToken, SessionID string
	IsNewUser                                    bool
}
type OAuthHandoff struct{ Code, AppRedirectURI string }
type OAuthLoginService struct {
	google *GoogleOIDC
	states *OAuthStateStore
	db     *sql.DB
	signer *Signer
}

func NewOAuthLoginService(google *GoogleOIDC, states *OAuthStateStore, database *sql.DB, signer *Signer) *OAuthLoginService {
	return &OAuthLoginService{google, states, database, signer}
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
	err = tx.QueryRowContext(ctx, `INSERT INTO users (id,google_subject_id,status,created_at,updated_at) VALUES ($1,$2,'active',$3,$3) ON CONFLICT (google_subject_id) DO UPDATE SET updated_at=EXCLUDED.updated_at RETURNING id,status`, candidateID, identity.Subject, created).Scan(&userID, &userStatus)
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
	result, err := s.createSession(ctx, tx, userID, now)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	payload, err := json.Marshal(result)
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

func (s *OAuthLoginService) createSession(ctx context.Context, tx *sql.Tx, userID string, now time.Time) (OAuthLoginResult, error) {
	sessionID, familyID, refreshID := newID(), newID(), newID()
	refresh, err := NewRefreshToken()
	if err != nil {
		return OAuthLoginResult{}, err
	}
	hash, err := HashRefreshToken(refresh)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	expires := now.Add(RefreshAbsoluteTTL).UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `INSERT INTO sessions (id,user_id,family_id,status,created_at,last_seen_at,expires_at) VALUES ($1,$2,$3,'active',$4,$4,$5)`, sessionID, userID, familyID, created, expires); err != nil {
		return OAuthLoginResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO refresh_tokens (id,session_id,token_hash,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5)`, refreshID, sessionID, hash, created, expires); err != nil {
		return OAuthLoginResult{}, err
	}
	access, _, err := s.signer.Issue(userID, sessionID, newID(), now)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	return OAuthLoginResult{UserID: userID, SessionID: sessionID, AccessToken: access, RefreshToken: refresh}, nil
}

package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

const SessionHandoffTTL = 10 * time.Minute

var ErrSessionHandoff = errors.New("session handoff is invalid, expired, or verifier-mismatched")

type SessionHandoffService struct {
	db       *sql.DB
	sessions *SessionService
	signer   *Signer
}

type SessionHandoff struct {
	Code           string
	AppRedirectURI string
}

func NewSessionHandoffService(database *sql.DB, sessions *SessionService, signer *Signer) *SessionHandoffService {
	return &SessionHandoffService{db: database, sessions: sessions, signer: signer}
}

// Create creates a new app session in the same transaction as the encrypted,
// one-time handoff record. The browser session must have a recent Passkey
// assertion; Google alone is deliberately insufficient for this transfer.
func (s *SessionHandoffService) Create(ctx context.Context, userID, sessionID, appRedirectURI, challenge string, now time.Time) (SessionHandoff, error) {
	if s.db == nil || s.sessions == nil || s.signer == nil || userID == "" || sessionID == "" || appRedirectURI == "" || challenge == "" {
		return SessionHandoff{}, ErrSessionHandoff
	}
	recent, err := s.sessions.HasRecentPasskey(ctx, userID, sessionID, now)
	if err != nil || !recent {
		return SessionHandoff{}, ErrSessionHandoff
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionHandoff{}, err
	}
	defer tx.Rollback()
	tokens, err := s.sessions.createSessionTx(ctx, tx, userID, now, true)
	if err != nil {
		return SessionHandoff{}, err
	}
	payload, err := json.Marshal(tokens) // #nosec G117 -- encrypted for a short-lived one-time handoff; never logged
	if err != nil {
		return SessionHandoff{}, err
	}
	ciphertext, nonce, err := s.signer.Seal(payload)
	if err != nil {
		return SessionHandoff{}, err
	}
	code, err := randomBase64URL(32)
	if err != nil {
		return SessionHandoff{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	_, err = tx.ExecContext(ctx, `INSERT INTO session_handoffs (code_hash,user_id,app_redirect_uri,code_challenge,response_ciphertext,response_nonce,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, hashOAuthState(code), userID, appRedirectURI, challenge, ciphertext, nonce, now.Add(SessionHandoffTTL).UTC().Format(time.RFC3339Nano), created)
	if err != nil {
		return SessionHandoff{}, err
	}
	if err = tx.Commit(); err != nil {
		return SessionHandoff{}, err
	}
	return SessionHandoff{Code: code, AppRedirectURI: appRedirectURI}, nil
}

func (s *SessionHandoffService) Exchange(ctx context.Context, code, verifier string, now time.Time) (SessionTokens, error) {
	if s.db == nil || s.signer == nil || code == "" || verifier == "" {
		return SessionTokens{}, ErrSessionHandoff
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionTokens{}, err
	}
	defer tx.Rollback()
	var challenge, ciphertext, nonce string
	var usedAt sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT code_challenge,response_ciphertext,response_nonce,used_at FROM session_handoffs WHERE code_hash=$1 AND expires_at>$2 FOR UPDATE`, hashOAuthState(code), now.UTC().Format(time.RFC3339Nano)).Scan(&challenge, &ciphertext, &nonce, &usedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionTokens{}, ErrSessionHandoff
	}
	if err != nil || subtle.ConstantTimeCompare([]byte(challenge), []byte(pkceChallenge(verifier))) != 1 {
		return SessionTokens{}, ErrSessionHandoff
	}
	plaintext, err := s.signer.Open(ciphertext, nonce)
	if err != nil {
		return SessionTokens{}, ErrSessionHandoff
	}
	var tokens SessionTokens
	if err = json.Unmarshal(plaintext, &tokens); err != nil || tokens.AccessToken == "" || tokens.RefreshToken == "" {
		return SessionTokens{}, ErrSessionHandoff
	}
	if !usedAt.Valid {
		if _, err = tx.ExecContext(ctx, `UPDATE session_handoffs SET used_at=$1 WHERE code_hash=$2`, now.UTC().Format(time.RFC3339Nano), hashOAuthState(code)); err != nil {
			return SessionTokens{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return SessionTokens{}, err
	}
	return tokens, nil
}

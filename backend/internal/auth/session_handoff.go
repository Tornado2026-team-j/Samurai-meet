package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	SessionHandoffTTL         = 10 * time.Minute
	SessionHandoffRetryWindow = 30 * time.Second
	maxHandoffRequestIDLength = 128
)

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
	payload, err := json.Marshal(tokens) // #nosec G117 -- serialized only as input to AES-GCM sealing below
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

// Exchange accepts a handoff response exactly once, except that an
// indistinguishable transport retry with the same request ID is allowed for a
// short bounded window. Callers must generate and persist requestID before
// sending their first exchange request.
func (s *SessionHandoffService) Exchange(ctx context.Context, code, verifier, requestID string, now time.Time) (SessionTokens, error) {
	if s.db == nil || s.signer == nil || code == "" || verifier == "" || strings.TrimSpace(requestID) == "" || len(requestID) > maxHandoffRequestIDLength {
		return SessionTokens{}, ErrSessionHandoff
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionTokens{}, err
	}
	defer tx.Rollback()
	var challenge, ciphertext, nonce string
	var usedAt, storedRequestID sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT code_challenge,response_ciphertext,response_nonce,used_at,exchange_request_id FROM session_handoffs WHERE code_hash=$1 AND expires_at>$2 FOR UPDATE`, hashOAuthState(code), now.UTC().Format(time.RFC3339Nano)).Scan(&challenge, &ciphertext, &nonce, &usedAt, &storedRequestID)
	if errors.Is(err, sql.ErrNoRows) || err != nil || subtle.ConstantTimeCompare([]byte(challenge), []byte(pkceChallenge(verifier))) != 1 {
		return SessionTokens{}, ErrSessionHandoff
	}
	if usedAt.Valid {
		used, parseErr := time.Parse(time.RFC3339Nano, usedAt.String)
		if parseErr != nil || !storedRequestID.Valid || subtle.ConstantTimeCompare([]byte(storedRequestID.String), []byte(requestID)) != 1 || now.After(used.Add(SessionHandoffRetryWindow)) {
			return SessionTokens{}, ErrSessionHandoff
		}
	} else if _, err = tx.ExecContext(ctx, `UPDATE session_handoffs SET used_at=$1,exchange_request_id=$2 WHERE code_hash=$3`, now.UTC().Format(time.RFC3339Nano), requestID, hashOAuthState(code)); err != nil {
		return SessionTokens{}, err
	}
	plaintext, err := s.signer.Open(ciphertext, nonce)
	if err != nil {
		return SessionTokens{}, ErrSessionHandoff
	}
	var tokens SessionTokens
	if err = json.Unmarshal(plaintext, &tokens); err != nil || tokens.AccessToken == "" || tokens.RefreshToken == "" {
		return SessionTokens{}, ErrSessionHandoff
	}
	if err = tx.Commit(); err != nil {
		return SessionTokens{}, err
	}
	return tokens, nil
}

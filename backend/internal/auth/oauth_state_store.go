package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"
)

const OAuthStateTTL = 10 * time.Minute

// OAuthStateStore persists one-time OAuth state and its PKCE verifier.
// The verifier is never sent to the browser, and a state may be consumed once.
type OAuthStateStore struct{ db *sql.DB }

type OAuthState struct {
	CodeVerifier     string
	AppRedirectURI   string
	HandoffChallenge string
}

func NewOAuthStateStore(db *sql.DB) *OAuthStateStore { return &OAuthStateStore{db: db} }

func (s *OAuthStateStore) Create(ctx context.Context, now time.Time, appRedirectURI, handoffChallenge string) (state, verifier string, err error) {
	state, err = randomBase64URL(32)
	if err != nil {
		return "", "", err
	}
	verifier, err = randomBase64URL(32)
	if err != nil {
		return "", "", err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO oauth_states (state_hash, code_verifier, app_redirect_uri, handoff_challenge, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, hashOAuthState(state), verifier, appRedirectURI, handoffChallenge, now.Add(OAuthStateTTL).UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano))
	return state, verifier, err
}

func (s *OAuthStateStore) Consume(ctx context.Context, state string, now time.Time) (OAuthState, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OAuthState{}, err
	}
	defer tx.Rollback()
	var result OAuthState
	err = tx.QueryRowContext(ctx, `SELECT code_verifier, COALESCE(app_redirect_uri, ''), COALESCE(handoff_challenge, '') FROM oauth_states WHERE state_hash=$1 AND used_at IS NULL AND expires_at > $2 FOR UPDATE`, hashOAuthState(state), now.UTC().Format(time.RFC3339Nano)).Scan(&result.CodeVerifier, &result.AppRedirectURI, &result.HandoffChallenge)
	if errors.Is(err, sql.ErrNoRows) {
		return OAuthState{}, errors.New("OAuth state is invalid, expired, or already used")
	}
	if err != nil {
		return OAuthState{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE oauth_states SET used_at=$1 WHERE state_hash=$2`, now.UTC().Format(time.RFC3339Nano), hashOAuthState(state)); err != nil {
		return OAuthState{}, err
	}
	return result, tx.Commit()
}

func hashOAuthState(state string) string {
	sum := sha256.Sum256([]byte(state))
	return hex.EncodeToString(sum[:])
}
func randomBase64URL(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func newID() string {
	value, err := randomBase64URL(18)
	if err != nil {
		panic("cryptographic random source failed: " + err.Error())
	}
	return value
}

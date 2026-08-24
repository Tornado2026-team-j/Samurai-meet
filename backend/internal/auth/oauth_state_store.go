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

func NewOAuthStateStore(db *sql.DB) *OAuthStateStore { return &OAuthStateStore{db: db} }

func (s *OAuthStateStore) Create(ctx context.Context, now time.Time) (state, verifier string, err error) {
	state, err = randomBase64URL(32)
	if err != nil {
		return "", "", err
	}
	verifier, err = randomBase64URL(32)
	if err != nil {
		return "", "", err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO oauth_states (state_hash, code_verifier, expires_at, created_at) VALUES ($1,$2,$3,$4)`, hashOAuthState(state), verifier, now.Add(OAuthStateTTL).UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano))
	return state, verifier, err
}

func (s *OAuthStateStore) Consume(ctx context.Context, state string, now time.Time) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var verifier string
	err = tx.QueryRowContext(ctx, `SELECT code_verifier FROM oauth_states WHERE state_hash=$1 AND used_at IS NULL AND expires_at > $2 FOR UPDATE`, hashOAuthState(state), now.UTC().Format(time.RFC3339Nano)).Scan(&verifier)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errors.New("OAuth state is invalid, expired, or already used")
	}
	if err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE oauth_states SET used_at=$1 WHERE state_hash=$2`, now.UTC().Format(time.RFC3339Nano), hashOAuthState(state)); err != nil {
		return "", err
	}
	return verifier, tx.Commit()
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

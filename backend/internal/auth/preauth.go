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

const (
	PreAuthScopeRegister PreAuthScope = "passkey_register"
	PreAuthScopeLogin    PreAuthScope = "passkey_login"
	PreAuthScopeReauth   PreAuthScope = "passkey_reauth"
	preAuthTokenMaxSize               = 256
	preAuthHashSize                   = 64
)

type PreAuthScope string

var ErrPreAuth = errors.New("pre-auth token is invalid, expired, used, or out of scope")

type PreAuthClaims struct {
	Token            string
	UserID           string
	Scope            PreAuthScope
	ExpiresAt        time.Time
	RecoveryVerified bool
}

type PreAuthService struct {
	db *sql.DB
}

func NewPreAuthService(database *sql.DB) *PreAuthService {
	return &PreAuthService{db: database}
}

func (s *PreAuthService) Issue(ctx context.Context, userID string, scope PreAuthScope, now time.Time) (string, error) {
	if s == nil || s.db == nil {
		return "", ErrPreAuth
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	token, err := s.IssueTx(ctx, tx, userID, scope, now)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return token, nil
}

func (s *PreAuthService) IssueTx(_ context.Context, tx *sql.Tx, userID string, scope PreAuthScope, now time.Time) (string, error) {
	if s == nil || tx == nil {
		return "", ErrPreAuth
	}
	return s.issueTx(tx, userID, scope, now, "")
}

// IssueRecoveryRegistrationTx issues the registration capability returned
// after Google plus a valid Recovery Phrase proof. The marker is server-side
// authorization state for the emergency account-deletion path; it is not
// exposed as a client decision and is consumed in the same delete transaction.
func (s *PreAuthService) IssueRecoveryRegistrationTx(_ context.Context, tx *sql.Tx, userID string, now time.Time) (string, error) {
	if s == nil || tx == nil {
		return "", ErrPreAuth
	}
	return s.issueTx(tx, userID, PreAuthScopeRegister, now, now.UTC().Format(time.RFC3339Nano))
}

func (s *PreAuthService) issueTx(tx *sql.Tx, userID string, scope PreAuthScope, now time.Time, recoveryVerifiedAt string) (string, error) {
	if tx == nil || userID == "" || !validPreAuthScope(scope) {
		return "", ErrPreAuth
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := hashPreAuthToken(token)
	created := now.UTC().Format(time.RFC3339Nano)
	_, err := tx.Exec(`INSERT INTO pre_auth_tokens (id,user_id,token_hash,scope,expires_at,recovery_verified_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, newID(), userID, hash, string(scope), now.Add(PreAuthTokenTTL).UTC().Format(time.RFC3339Nano), nullableString(recoveryVerifiedAt), created)
	if err != nil {
		return "", err
	}
	return token, nil
}

func (s *PreAuthService) Lookup(ctx context.Context, token string, scope PreAuthScope, userID string, now time.Time) (PreAuthClaims, error) {
	if s == nil || s.db == nil || token == "" || len(token) > preAuthTokenMaxSize || !validPreAuthScope(scope) {
		return PreAuthClaims{}, ErrPreAuth
	}
	var storedUser, storedScope, expires, recoveryVerifiedAt string
	err := s.db.QueryRowContext(ctx, `SELECT user_id,scope,expires_at,COALESCE(recovery_verified_at,'') FROM pre_auth_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>$2`, hashPreAuthToken(token), now.UTC().Format(time.RFC3339Nano)).Scan(&storedUser, &storedScope, &expires, &recoveryVerifiedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PreAuthClaims{}, ErrPreAuth
	}
	if err != nil {
		return PreAuthClaims{}, err
	}
	if storedScope != string(scope) || (userID != "" && storedUser != userID) {
		return PreAuthClaims{}, ErrPreAuth
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		return PreAuthClaims{}, ErrPreAuth
	}
	return PreAuthClaims{Token: token, UserID: storedUser, Scope: scope, ExpiresAt: expiresAt, RecoveryVerified: recoveryVerifiedAt != ""}, nil
}

func (s *PreAuthService) ConsumeTx(tx *sql.Tx, token string, scope PreAuthScope, userID string, now time.Time) error {
	if tx == nil || token == "" || len(token) > preAuthTokenMaxSize || !validPreAuthScope(scope) {
		return ErrPreAuth
	}
	var storedUser, storedScope, expires string
	err := tx.QueryRow(`SELECT user_id,scope,expires_at FROM pre_auth_tokens WHERE token_hash=$1 AND used_at IS NULL FOR UPDATE`, hashPreAuthToken(token)).Scan(&storedUser, &storedScope, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrPreAuth
	}
	if err != nil {
		return err
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !now.Before(expiresAt) || storedScope != string(scope) || (userID != "" && storedUser != userID) {
		return ErrPreAuth
	}
	_, err = tx.Exec(`UPDATE pre_auth_tokens SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL`, now.UTC().Format(time.RFC3339Nano), hashPreAuthToken(token))
	return err
}

// ConsumeHash is used by server-side bootstrap flows that deliberately never
// retain or reintroduce the raw pre-auth token after it leaves the app.
func (s *PreAuthService) ConsumeHash(ctx context.Context, tokenHash string, scope PreAuthScope, userID string, now time.Time) error {
	if s == nil || s.db == nil || len(tokenHash) != preAuthHashSize || tokenHash == "" || !validPreAuthScope(scope) {
		return ErrPreAuth
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = s.consumeHashTx(tx, tokenHash, scope, userID, now); err != nil {
		return err
	}
	return tx.Commit()
}

// consumeHashTx consumes a pre-auth hash in the caller's transaction. Web
// Passkey completion uses this to keep source-capability validation atomic
// with credential and session creation.
func (s *PreAuthService) consumeHashTx(tx *sql.Tx, tokenHash string, scope PreAuthScope, userID string, now time.Time) error {
	if tx == nil || len(tokenHash) != preAuthHashSize || tokenHash == "" || !validPreAuthScope(scope) {
		return ErrPreAuth
	}
	var storedUser, storedScope, expires string
	err := tx.QueryRow(`SELECT user_id,scope,expires_at FROM pre_auth_tokens WHERE token_hash=$1 AND used_at IS NULL FOR UPDATE`, tokenHash).Scan(&storedUser, &storedScope, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrPreAuth
	}
	if err != nil {
		return err
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !now.Before(expiresAt) || storedScope != string(scope) || (userID != "" && storedUser != userID) {
		return ErrPreAuth
	}
	_, err = tx.Exec(`UPDATE pre_auth_tokens SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL`, now.UTC().Format(time.RFC3339Nano), tokenHash)
	return err
}

func validPreAuthScope(scope PreAuthScope) bool {
	switch scope {
	case PreAuthScopeRegister, PreAuthScopeLogin, PreAuthScopeReauth:
		return true
	default:
		return false
	}
}

func hashPreAuthToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// HashPreAuthToken exposes only the one-way storage representation needed by
// other authentication-bound services. The raw pre-auth token remains a
// client-held capability and is never persisted by this helper.
func HashPreAuthToken(token string) string {
	return hashPreAuthToken(token)
}

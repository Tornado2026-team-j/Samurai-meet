package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"time"
)

const PasskeyBootstrapTTL = time.Minute

var ErrPasskeyBootstrap = errors.New("passkey bootstrap is invalid, expired, or already used")

type PasskeyBootstrapScope string

const (
	PasskeyBootstrapRegister PasskeyBootstrapScope = "passkey_register"
	PasskeyBootstrapLogin    PasskeyBootstrapScope = "passkey_login"
	PasskeyBootstrapReauth   PasskeyBootstrapScope = "passkey_reauth" // #nosec G101 -- fixed protocol scope, not a credential
)

type PasskeyBootstrap struct {
	Token             string
	UserID            string
	SessionID         string
	SourcePreAuthHash string
	CeremonyTokenHash string
	Scope             PasskeyBootstrapScope
	AppRedirectURI    string
	HandoffChallenge  string
	ExpiresAt         time.Time
}

type PasskeyBootstrapService struct{ db *sql.DB }

func NewPasskeyBootstrapService(database *sql.DB) *PasskeyBootstrapService {
	return &PasskeyBootstrapService{db: database}
}

func (s *PasskeyBootstrapService) IssueFromSession(ctx context.Context, userID, sessionID string, scope PasskeyBootstrapScope, appRedirectURI, handoffChallenge string, now time.Time) (PasskeyBootstrap, error) {
	if s.db == nil || userID == "" || sessionID == "" || !validBootstrapScope(scope) || appRedirectURI == "" || handoffChallenge == "" {
		return PasskeyBootstrap{}, ErrPasskeyBootstrap
	}
	return s.issue(ctx, userID, sessionID, "", scope, appRedirectURI, handoffChallenge, now)
}

// IssueFromPreAuth records only the pre-auth hash. The original pre-auth
// capability is consumed later, in the successful Passkey transaction.
func (s *PasskeyBootstrapService) IssueFromPreAuth(ctx context.Context, userID, preAuthToken string, scope PasskeyBootstrapScope, appRedirectURI, handoffChallenge string, now time.Time) (PasskeyBootstrap, error) {
	if s.db == nil || userID == "" || preAuthToken == "" || (scope != PasskeyBootstrapRegister && scope != PasskeyBootstrapLogin) || appRedirectURI == "" || handoffChallenge == "" {
		return PasskeyBootstrap{}, ErrPasskeyBootstrap
	}
	return s.issue(ctx, userID, "", hashPreAuthToken(preAuthToken), scope, appRedirectURI, handoffChallenge, now)
}

func (s *PasskeyBootstrapService) issue(ctx context.Context, userID, sessionID, preAuthHash string, scope PasskeyBootstrapScope, appRedirectURI, handoffChallenge string, now time.Time) (PasskeyBootstrap, error) {
	token, err := randomBase64URL(32)
	if err != nil {
		return PasskeyBootstrap{}, err
	}
	expires := now.Add(PasskeyBootstrapTTL)
	_, err = s.db.ExecContext(ctx, `INSERT INTO passkey_bootstraps (id,token_hash,user_id,source_session_id,source_pre_auth_hash,scope,app_redirect_uri,handoff_challenge,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, newID(), hashOAuthState(token), userID, nullableString(sessionID), nullableString(preAuthHash), string(scope), appRedirectURI, handoffChallenge, expires.UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return PasskeyBootstrap{}, err
	}
	return PasskeyBootstrap{Token: token, UserID: userID, SessionID: sessionID, SourcePreAuthHash: preAuthHash, Scope: scope, AppRedirectURI: appRedirectURI, HandoffChallenge: handoffChallenge, ExpiresAt: expires}, nil
}

func (s *PasskeyBootstrapService) Lookup(ctx context.Context, token string, scope PasskeyBootstrapScope, now time.Time) (PasskeyBootstrap, error) {
	if s.db == nil || token == "" || !validBootstrapScope(scope) {
		return PasskeyBootstrap{}, ErrPasskeyBootstrap
	}
	var item PasskeyBootstrap
	var storedScope, expires string
	var sessionID, sourcePreAuthHash, ceremonyTokenHash, usedAt sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT user_id,source_session_id,source_pre_auth_hash,ceremony_token_hash,scope,app_redirect_uri,handoff_challenge,expires_at,used_at FROM passkey_bootstraps WHERE token_hash=$1`, hashOAuthState(token)).Scan(&item.UserID, &sessionID, &sourcePreAuthHash, &ceremonyTokenHash, &storedScope, &item.AppRedirectURI, &item.HandoffChallenge, &expires, &usedAt)
	if err != nil || usedAt.Valid || storedScope != string(scope) {
		return PasskeyBootstrap{}, ErrPasskeyBootstrap
	}
	item.ExpiresAt, err = time.Parse(time.RFC3339Nano, expires)
	if err != nil || !item.ExpiresAt.After(now) {
		return PasskeyBootstrap{}, ErrPasskeyBootstrap
	}
	item.Token = token
	item.SessionID = sessionID.String
	item.SourcePreAuthHash = sourcePreAuthHash.String
	item.CeremonyTokenHash = ceremonyTokenHash.String
	item.Scope = scope
	return item, nil
}

func (s *PasskeyBootstrapService) ConsumeTx(tx *sql.Tx, token string, scope PasskeyBootstrapScope, userID string, now time.Time) error {
	if tx == nil || token == "" || userID == "" || !validBootstrapScope(scope) {
		return ErrPasskeyBootstrap
	}
	var storedUser, storedScope string
	var expires string
	var usedAt sql.NullString
	err := tx.QueryRow(`SELECT user_id,scope,expires_at,used_at FROM passkey_bootstraps WHERE token_hash=$1 FOR UPDATE`, hashOAuthState(token)).Scan(&storedUser, &storedScope, &expires, &usedAt)
	if err != nil || usedAt.Valid || storedScope != string(scope) || subtle.ConstantTimeCompare([]byte(storedUser), []byte(userID)) != 1 {
		return ErrPasskeyBootstrap
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !expiresAt.After(now) {
		return ErrPasskeyBootstrap
	}
	_, err = tx.Exec(`UPDATE passkey_bootstraps SET used_at=$1 WHERE token_hash=$2`, now.UTC().Format(time.RFC3339Nano), hashOAuthState(token))
	return err
}

// BindCeremony fixes the WebAuthn ceremony to the one-time bootstrap before
// any assertion is accepted. The binding is immutable and checked again at
// consumption, preventing token swapping or cross-session replay.
func (s *PasskeyBootstrapService) BindCeremony(ctx context.Context, token string, scope PasskeyBootstrapScope, userID, sessionID, ceremonyToken string, now time.Time) error {
	if s.db == nil || token == "" || ceremonyToken == "" || userID == "" || !validBootstrapScope(scope) {
		return ErrPasskeyBootstrap
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var storedUser, storedScope, expires string
	var storedSession, storedCeremony, usedAt sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT user_id,source_session_id,scope,expires_at,used_at,ceremony_token_hash FROM passkey_bootstraps WHERE token_hash=$1 FOR UPDATE`, hashOAuthState(token)).Scan(&storedUser, &storedSession, &storedScope, &expires, &usedAt, &storedCeremony)
	if err != nil || usedAt.Valid || storedCeremony.Valid || storedScope != string(scope) || subtle.ConstantTimeCompare([]byte(storedUser), []byte(userID)) != 1 || (storedSession.Valid && storedSession.String != sessionID) || (!storedSession.Valid && sessionID != "") {
		return ErrPasskeyBootstrap
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !expiresAt.After(now) {
		return ErrPasskeyBootstrap
	}
	if _, err = tx.ExecContext(ctx, `UPDATE passkey_bootstraps SET ceremony_token_hash=$1 WHERE token_hash=$2 AND ceremony_token_hash IS NULL`, hashOAuthState(ceremonyToken), hashOAuthState(token)); err != nil {
		return err
	}
	return tx.Commit()
}

// Consume atomically marks a bound bootstrap as used and verifies every
// immutable binding. It is deliberately separate from Lookup so a successful
// assertion cannot be replayed by a second HTTP request.
func (s *PasskeyBootstrapService) Consume(ctx context.Context, token string, scope PasskeyBootstrapScope, userID, sessionID, ceremonyToken string, now time.Time) error {
	if s.db == nil || token == "" || ceremonyToken == "" || userID == "" || !validBootstrapScope(scope) {
		return ErrPasskeyBootstrap
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var storedUser, storedScope, expires string
	var storedSession, storedCeremony, usedAt sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT user_id,source_session_id,scope,expires_at,used_at,ceremony_token_hash FROM passkey_bootstraps WHERE token_hash=$1 FOR UPDATE`, hashOAuthState(token)).Scan(&storedUser, &storedSession, &storedScope, &expires, &usedAt, &storedCeremony)
	if err != nil || usedAt.Valid || !storedCeremony.Valid || subtle.ConstantTimeCompare([]byte(storedCeremony.String), []byte(hashOAuthState(ceremonyToken))) != 1 || storedScope != string(scope) || subtle.ConstantTimeCompare([]byte(storedUser), []byte(userID)) != 1 || (storedSession.Valid && storedSession.String != sessionID) || (!storedSession.Valid && sessionID != "") {
		return ErrPasskeyBootstrap
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !expiresAt.After(now) {
		return ErrPasskeyBootstrap
	}
	if _, err = tx.ExecContext(ctx, `UPDATE passkey_bootstraps SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL`, now.UTC().Format(time.RFC3339Nano), hashOAuthState(token)); err != nil {
		return err
	}
	return tx.Commit()
}

func validBootstrapScope(scope PasskeyBootstrapScope) bool {
	return scope == PasskeyBootstrapRegister || scope == PasskeyBootstrapLogin || scope == PasskeyBootstrapReauth
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

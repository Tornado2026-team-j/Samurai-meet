package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"time"
)

// LookupAny resolves the scope from the opaque bootstrap token. The token is
// still checked for expiry and one-time use; callers must apply the returned
// scope to the ceremony operation.
func (s *PasskeyBootstrapService) LookupAny(ctx context.Context, token string, now time.Time) (PasskeyBootstrap, error) {
	if s == nil || s.db == nil || token == "" {
		return PasskeyBootstrap{}, ErrPasskeyBootstrap
	}
	var item PasskeyBootstrap
	var storedScope, expires string
	var sessionID, sourcePreAuthHash, ceremonyTokenHash, usedAt sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT user_id,source_session_id,source_pre_auth_hash,ceremony_token_hash,scope,app_redirect_uri,handoff_challenge,expires_at,used_at FROM passkey_bootstraps WHERE token_hash=$1`, hashOAuthState(token)).Scan(&item.UserID, &sessionID, &sourcePreAuthHash, &ceremonyTokenHash, &storedScope, &item.AppRedirectURI, &item.HandoffChallenge, &expires, &usedAt)
	if err != nil || usedAt.Valid {
		return PasskeyBootstrap{}, ErrPasskeyBootstrap
	}
	item.Scope = PasskeyBootstrapScope(storedScope)
	if !validBootstrapScope(item.Scope) {
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
	return item, nil
}

// ValidateCeremony checks the immutable bootstrap-to-ceremony binding before
// invoking WebAuthn verification, avoiding assertion work for a swapped token.
func (s *PasskeyBootstrapService) ValidateCeremony(ctx context.Context, token string, scope PasskeyBootstrapScope, userID, sessionID, ceremonyToken string, now time.Time) error {
	if s == nil || s.db == nil || token == "" || ceremonyToken == "" || userID == "" || !validBootstrapScope(scope) {
		return ErrPasskeyBootstrap
	}
	var storedUser, storedScope, expires string
	var storedSession, storedCeremony, usedAt sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT user_id,source_session_id,scope,expires_at,used_at,ceremony_token_hash FROM passkey_bootstraps WHERE token_hash=$1`, hashOAuthState(token)).Scan(&storedUser, &storedSession, &storedScope, &expires, &usedAt, &storedCeremony)
	if err != nil || usedAt.Valid || !storedCeremony.Valid || storedScope != string(scope) || subtle.ConstantTimeCompare([]byte(storedUser), []byte(userID)) != 1 || (storedSession.Valid && storedSession.String != sessionID) || (!storedSession.Valid && sessionID != "") || subtle.ConstantTimeCompare([]byte(storedCeremony.String), []byte(hashOAuthState(ceremonyToken))) != 1 {
		return ErrPasskeyBootstrap
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !expiresAt.After(now) {
		return ErrPasskeyBootstrap
	}
	return nil
}

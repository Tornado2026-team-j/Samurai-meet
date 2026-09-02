package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"time"
)

// ResetCeremony invalidates a browser-side WebAuthn attempt and unbinds the
// one-time bootstrap so the page can obtain a fresh ceremony. It is only
// usable with the exact opaque bootstrap and currently bound ceremony token.
// The auth challenge is consumed before the binding is cleared; doing both in
// one transaction prevents a concurrent verification from being replayed.
func (s *PasskeyBootstrapService) ResetCeremony(ctx context.Context, token string, scope PasskeyBootstrapScope, userID, sessionID, ceremonyToken string, now time.Time) error {
	if ceremonyToken == "" {
		return ErrPasskeyBootstrap
	}
	return s.resetCeremony(ctx, token, scope, userID, sessionID, ceremonyToken, now)
}

// ResetBoundCeremony is used when the browser lost the options response after
// the server had already created and bound a WebAuthn ceremony. The raw
// ceremony token is intentionally not stored in passkey_bootstraps, so this
// path invalidates the currently stored challenge by its hash and clears the
// binding atomically. Possession of the still-valid one-time bootstrap is
// required; this only recovers from a lost options response and cannot be used
// after the bootstrap has been consumed or expired.
func (s *PasskeyBootstrapService) ResetBoundCeremony(ctx context.Context, token string, scope PasskeyBootstrapScope, userID, sessionID string, now time.Time) error {
	return s.resetCeremony(ctx, token, scope, userID, sessionID, "", now)
}

func (s *PasskeyBootstrapService) resetCeremony(ctx context.Context, token string, scope PasskeyBootstrapScope, userID, sessionID, ceremonyToken string, now time.Time) error {
	if s == nil || s.db == nil || token == "" || userID == "" || !validBootstrapScope(scope) {
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
	if err != nil || usedAt.Valid || !storedCeremony.Valid || storedScope != string(scope) || subtle.ConstantTimeCompare([]byte(storedUser), []byte(userID)) != 1 || (storedSession.Valid && storedSession.String != sessionID) || (!storedSession.Valid && sessionID != "") {
		return ErrPasskeyBootstrap
	}
	if ceremonyToken != "" && subtle.ConstantTimeCompare([]byte(storedCeremony.String), []byte(hashOAuthState(ceremonyToken))) != 1 {
		return ErrPasskeyBootstrap
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !expiresAt.After(now) {
		return ErrPasskeyBootstrap
	}

	result, err := tx.ExecContext(ctx, `UPDATE auth_challenges SET used_at=$1 WHERE token_hash=$2 AND type=$3 AND used_at IS NULL`, now.UTC().Format(time.RFC3339Nano), storedCeremony.String, string(scope))
	if err != nil {
		return err
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
		return ErrPasskeyBootstrap
	}
	result, err = tx.ExecContext(ctx, `UPDATE passkey_bootstraps SET ceremony_token_hash=NULL WHERE token_hash=$1 AND ceremony_token_hash=$2 AND used_at IS NULL`, hashOAuthState(token), storedCeremony.String)
	if err != nil {
		return err
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
		return ErrPasskeyBootstrap
	}
	return tx.Commit()
}

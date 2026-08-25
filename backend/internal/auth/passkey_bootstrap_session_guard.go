package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"time"
)

// ConsumeWithSourceSession is the Web-flow terminal consumption operation.
// For session-origin bootstraps it locks and rechecks the issuing session in
// the same transaction as consuming the bootstrap, so logout, revocation,
// expiry, and idle timeout all invalidate an in-flight capability.
func (s *PasskeyBootstrapService) ConsumeWithSourceSession(ctx context.Context, token string, scope PasskeyBootstrapScope, userID, sessionID, ceremonyToken string, now time.Time) error {
	if s == nil || s.db == nil || token == "" || ceremonyToken == "" || userID == "" || !validBootstrapScope(scope) {
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
	if storedSession.Valid {
		var status, sessionExpires, lastSeen string
		var revokedAt sql.NullString
		err = tx.QueryRowContext(ctx, `SELECT status,expires_at,last_seen_at,revoked_at FROM sessions WHERE id=$1 AND user_id=$2 FOR UPDATE`, storedSession.String, storedUser).Scan(&status, &sessionExpires, &lastSeen, &revokedAt)
		if err != nil || status != string(SessionActive) || revokedAt.Valid {
			return ErrPasskeyBootstrap
		}
		expiresAt, expiryErr := time.Parse(time.RFC3339Nano, sessionExpires)
		lastSeenAt, lastSeenErr := time.Parse(time.RFC3339Nano, lastSeen)
		if expiryErr != nil || lastSeenErr != nil || !now.Before(expiresAt) || !now.Before(lastSeenAt.Add(RefreshIdleTTL)) {
			return ErrPasskeyBootstrap
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE passkey_bootstraps SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL`, now.UTC().Format(time.RFC3339Nano), hashOAuthState(token)); err != nil {
		return err
	}
	return tx.Commit()
}

package auth

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type SessionStore struct{ db *sql.DB }

func NewSessionStore(db *sql.DB) *SessionStore { return &SessionStore{db} }
func (s *SessionStore) RevokeSession(ctx context.Context, sessionID, reason string, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE sessions SET status='revoked', revoked_at=$1, revoked_reason=$2 WHERE id=$3 AND revoked_at IS NULL", now.UTC().Format(time.RFC3339Nano), reason, sessionID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE refresh_tokens SET revoked_at=$1 WHERE session_id=$2 AND revoked_at IS NULL", now.UTC().Format(time.RFC3339Nano), sessionID); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *SessionStore) RevokeAllForUser(ctx context.Context, userID, reason string, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE sessions SET status='revoked', revoked_at=$1, revoked_reason=$2 WHERE user_id=$3 AND revoked_at IS NULL", now.UTC().Format(time.RFC3339Nano), reason, userID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE refresh_tokens rt SET revoked_at=$1 FROM sessions s WHERE rt.session_id=s.id AND s.user_id=$2 AND rt.revoked_at IS NULL", now.UTC().Format(time.RFC3339Nano), userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SessionStore) RevokeOtherForUser(ctx context.Context, userID, currentSessionID, reason string, now time.Time) error {
	if s == nil || s.db == nil || userID == "" || currentSessionID == "" {
		return errors.New("session is invalid")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stamp := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, "UPDATE sessions SET status='revoked', revoked_at=$1, revoked_reason=$2 WHERE user_id=$3 AND id<>$4 AND revoked_at IS NULL", stamp, reason, userID, currentSessionID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE refresh_tokens rt SET revoked_at=$1 FROM sessions s WHERE rt.session_id=s.id AND s.user_id=$2 AND s.id<>$3 AND rt.revoked_at IS NULL", stamp, userID, currentSessionID); err != nil {
		return err
	}
	return tx.Commit()
}

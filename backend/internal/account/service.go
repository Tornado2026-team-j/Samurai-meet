// Package account contains destructive account lifecycle operations.
package account

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
)

var ErrAccountNotFound = errors.New("account not found")
var ErrStorageCleanupPending = errors.New("encrypted image cleanup is pending")

type Service struct {
	db     *sql.DB
	images *image.Service
}

func NewService(database *sql.DB, images *image.Service) *Service {
	return &Service{db: database, images: images}
}

// Delete permanently removes the user's PostgreSQL rows and encrypted image
// directory. Database deletion is committed before filesystem cleanup so a
// failed SQL operation can never leave an account whose ciphertext was
// already destroyed. A durable cleanup job keeps retryable storage cleanup
// state when the filesystem is temporarily unavailable.
func (s *Service) Delete(ctx context.Context, userID string, now time.Time) error {
	return s.delete(ctx, userID, now, nil)
}

// DeleteWithAuthorization performs the same permanent deletion while
// allowing the caller to consume a second, transaction-bound capability
// before commit. It is used for Recovery-based emergency deletion when no
// Passkey session exists.
func (s *Service) DeleteWithAuthorization(ctx context.Context, userID string, now time.Time, authorize func(*sql.Tx) error) error {
	return s.delete(ctx, userID, now, authorize)
}

func (s *Service) delete(ctx context.Context, userID string, now time.Time, authorize func(*sql.Tx) error) error {
	if s == nil || s.db == nil || userID == "" {
		return ErrAccountNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var status string
	if err = tx.QueryRowContext(ctx, `SELECT status FROM users WHERE id=$1 FOR UPDATE`, userID).Scan(&status); errors.Is(err, sql.ErrNoRows) {
		return ErrAccountNotFound
	} else if err != nil {
		return err
	}

	if s.images != nil {
		stamp := now.UTC().Format(time.RFC3339Nano)
		if _, err = tx.ExecContext(ctx, `INSERT INTO storage_cleanup_jobs (user_id,attempts,last_error,created_at,updated_at) VALUES ($1,0,'',$2,$2) ON CONFLICT (user_id) DO NOTHING`, userID, stamp); err != nil {
			return err
		}
	}
	if authorize != nil {
		if err = authorize(tx); err != nil {
			return err
		}
	}

	// Files are deliberately not touched before this transaction commits.
	deletedAt := now.UTC().Format(time.RFC3339Nano)
	statements := []string{
		`UPDATE sessions SET status='revoked',revoked_at=$1,revoked_reason='account_deleted' WHERE user_id=$2 AND revoked_at IS NULL`,
		`DELETE FROM refresh_attempts WHERE session_id IN (SELECT id FROM sessions WHERE user_id=$1)`,
		`DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id=$1)`,
		`DELETE FROM auth_challenges WHERE user_id=$1`,
		`DELETE FROM pre_auth_tokens WHERE user_id=$1`,
		`DELETE FROM recovery_challenges WHERE user_id=$1`,
		`DELETE FROM passkey_bootstraps WHERE user_id=$1`,
		`DELETE FROM passkey_credentials WHERE user_id=$1`,
		`DELETE FROM key_envelopes WHERE user_id=$1`,
		`DELETE FROM device_request_nonces WHERE user_id=$1`,
		`DELETE FROM photo_device_key_envelopes WHERE user_id=$1`,
		`DELETE FROM devices WHERE user_id=$1`,
		`DELETE FROM key_b_materials WHERE user_id=$1`,
		`DELETE FROM oauth_handoffs WHERE user_id=$1`,
		`DELETE FROM session_handoffs WHERE user_id=$1`,
		`DELETE FROM photos WHERE owner_user_id=$1`,
		`DELETE FROM sessions WHERE user_id=$1`,
		`DELETE FROM users WHERE id=$1`,
	}
	for i, statement := range statements {
		if i == 0 {
			if _, err = tx.ExecContext(ctx, statement, deletedAt, userID); err != nil {
				return err
			}
			continue
		}
		if _, err = tx.ExecContext(ctx, statement, userID); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if s.images == nil {
		return nil
	}
	if err = s.images.DeleteUserFiles(userID); err != nil {
		_, _ = s.db.ExecContext(ctx, `UPDATE storage_cleanup_jobs SET attempts=attempts+1,last_error=$1,updated_at=$2 WHERE user_id=$3`, truncateCleanupError(err), now.UTC().Format(time.RFC3339Nano), userID)
		return fmt.Errorf("%w: %v", ErrStorageCleanupPending, err)
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM storage_cleanup_jobs WHERE user_id=$1`, userID)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrStorageCleanupPending, err)
	}
	return nil
}

func truncateCleanupError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 512 {
		return message[:512]
	}
	return message
}

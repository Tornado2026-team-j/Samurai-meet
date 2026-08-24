// Package account contains destructive account lifecycle operations.
package account

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
)

var ErrAccountNotFound = errors.New("account not found")

type Service struct {
	db     *sql.DB
	images *image.Service
}

func NewService(database *sql.DB, images *image.Service) *Service {
	return &Service{db: database, images: images}
}

// Delete permanently removes the user's PostgreSQL rows and encrypted image
// directory. The caller must authenticate with an active access token and a
// deliberate confirmation string before invoking this method.
func (s *Service) Delete(ctx context.Context, userID string, now time.Time) error {
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

	// Remove the filesystem copy while the row lock is held. If removal fails,
	// rollback keeps the account and metadata available for a retry.
	if s.images != nil {
		if err = s.images.DeleteUserFiles(userID); err != nil {
			return err
		}
	}
	deletedAt := now.UTC().Format(time.RFC3339Nano)
	statements := []string{
		`UPDATE sessions SET status='revoked',revoked_at=$1,revoked_reason='account_deleted' WHERE user_id=$2 AND revoked_at IS NULL`,
		`DELETE FROM refresh_attempts WHERE session_id IN (SELECT id FROM sessions WHERE user_id=$1)`,
		`DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id=$1)`,
		`DELETE FROM auth_challenges WHERE user_id=$1`,
		`DELETE FROM pre_auth_tokens WHERE user_id=$1`,
		`DELETE FROM passkey_credentials WHERE user_id=$1`,
		`DELETE FROM key_envelopes WHERE user_id=$1`,
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
	return tx.Commit()
}

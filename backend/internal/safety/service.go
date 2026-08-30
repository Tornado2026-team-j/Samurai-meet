// Package safety implements user-facing reporting and blocking. The moderation
// queue and admin actions (docs/features/safety.md §5) are out of scope here;
// this package only records reports and maintains the blocks table that
// matching and chat already read for access control.
package safety

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidReport  = errors.New("invalid report")
	ErrInvalidBlock   = errors.New("invalid block")
	ErrTargetNotFound = errors.New("report target not found")
	ErrSelfBlock      = errors.New("cannot block yourself")
	ErrBlockNotFound  = errors.New("block not found")
)

const (
	maxReportComment = 2000
	maxTargetIDRunes = 256
)

var reportTargetTypes = map[string]bool{
	"user": true, "recruitment_card": true, "message": true, "photo": true,
}

var reportReasons = map[string]bool{
	"nuisance": true, "harassment": true, "impersonation": true,
	"inappropriate_photo": true, "dangerous": true, "other": true,
}

type Service struct {
	db *sql.DB
}

func NewService(database *sql.DB) *Service { return &Service{db: database} }

type ReportInput struct {
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
	Reason     string `json:"reason"`
	Comment    string `json:"comment"`
}

type Report struct {
	ID         string `json:"id"`
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
	Reason     string `json:"reason"`
	Comment    string `json:"comment"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
}

type BlockedUser struct {
	UserID    string `json:"user_id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

// CreateReport records a report. A repeat of the same (reporter, target) while
// an earlier report is still open returns that earlier report unchanged.
func (s *Service) CreateReport(ctx context.Context, reporterID string, input ReportInput, now time.Time) (Report, error) {
	if s == nil || s.db == nil || strings.TrimSpace(reporterID) == "" {
		return Report{}, ErrInvalidReport
	}
	input.TargetType = strings.TrimSpace(input.TargetType)
	input.TargetID = strings.TrimSpace(input.TargetID)
	input.Reason = strings.TrimSpace(input.Reason)
	if !reportTargetTypes[input.TargetType] || !reportReasons[input.Reason] {
		return Report{}, ErrInvalidReport
	}
	if input.TargetID == "" || utf8.RuneCountInString(input.TargetID) > maxTargetIDRunes {
		return Report{}, ErrInvalidReport
	}
	if !utf8.ValidString(input.Comment) || utf8.RuneCountInString(input.Comment) > maxReportComment {
		return Report{}, ErrInvalidReport
	}
	if input.TargetType == "user" && input.TargetID == reporterID {
		return Report{}, ErrInvalidReport
	}
	reportable, err := s.reportTargetExists(ctx, reporterID, input.TargetType, input.TargetID)
	if err != nil {
		return Report{}, err
	}
	if !reportable {
		return Report{}, ErrTargetNotFound
	}

	id, err := randomID()
	if err != nil {
		return Report{}, err
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	var report Report
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO reports (id,reporter_user_id,target_type,target_id,reason,comment,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
		ON CONFLICT (reporter_user_id,target_type,target_id) WHERE status IN ('received','reviewing') DO NOTHING
		RETURNING id,target_type,target_id,reason,comment,status,created_at`,
		id, reporterID, input.TargetType, input.TargetID, input.Reason, input.Comment, stamp).Scan(
		&report.ID, &report.TargetType, &report.TargetID, &report.Reason, &report.Comment, &report.Status, &report.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		if err = s.db.QueryRowContext(ctx, `
			SELECT id,target_type,target_id,reason,comment,status,created_at FROM reports
			WHERE reporter_user_id=$1 AND target_type=$2 AND target_id=$3 AND status IN ('received','reviewing')
			ORDER BY created_at DESC LIMIT 1`,
			reporterID, input.TargetType, input.TargetID).Scan(
			&report.ID, &report.TargetType, &report.TargetID, &report.Reason, &report.Comment, &report.Status, &report.CreatedAt); err != nil {
			return Report{}, err
		}
		return report, nil
	}
	if err != nil {
		return Report{}, err
	}
	return report, nil
}

// BlockUser adds a block. It is idempotent: blocking an already-blocked user
// succeeds without change.
func (s *Service) BlockUser(ctx context.Context, blockerID, blockedID string, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(blockerID) == "" {
		return ErrInvalidBlock
	}
	blockedID = strings.TrimSpace(blockedID)
	if blockedID == "" || utf8.RuneCountInString(blockedID) > maxTargetIDRunes {
		return ErrInvalidBlock
	}
	if blockedID == blockerID {
		return ErrSelfBlock
	}
	exists, err := s.userExists(ctx, blockedID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrTargetNotFound
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO blocks (blocker_user_id,blocked_user_id,created_at)
		VALUES ($1,$2,$3)
		ON CONFLICT (blocker_user_id,blocked_user_id) DO NOTHING`,
		blockerID, blockedID, now.UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Service) Unblock(ctx context.Context, blockerID, blockedID string) error {
	if s == nil || s.db == nil || strings.TrimSpace(blockerID) == "" || strings.TrimSpace(blockedID) == "" {
		return ErrInvalidBlock
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2`, blockerID, blockedID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrBlockNotFound
	}
	return nil
}

func (s *Service) ListBlocks(ctx context.Context, blockerID string) ([]BlockedUser, error) {
	if s == nil || s.db == nil || strings.TrimSpace(blockerID) == "" {
		return nil, ErrInvalidBlock
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT b.blocked_user_id, COALESCE(NULLIF(p.name,''), u.display_name, ''), b.created_at
		FROM blocks b
		JOIN users u ON u.id = b.blocked_user_id
		LEFT JOIN profiles p ON p.user_id = b.blocked_user_id
		WHERE b.blocker_user_id = $1
		ORDER BY b.created_at DESC`, blockerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	blocked := make([]BlockedUser, 0)
	for rows.Next() {
		var item BlockedUser
		if err := rows.Scan(&item.UserID, &item.Name, &item.CreatedAt); err != nil {
			return nil, err
		}
		blocked = append(blocked, item)
	}
	return blocked, rows.Err()
}

func (s *Service) userExists(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND status='active')`, userID).Scan(&exists)
	return exists, err
}

// reportTargetExists applies object-level authorization before a report is
// persisted. Reports are intentionally accepted for objects the reporter can
// reasonably have seen, but never for arbitrary IDs outside that scope.
//
// We return the same false result for an unknown object and an unauthorized
// object so this endpoint does not become an object-existence oracle.
func (s *Service) reportTargetExists(ctx context.Context, reporterID, targetType, targetID string) (bool, error) {
	switch targetType {
	case "user":
		return s.userExists(ctx, targetID)
	case "recruitment_card":
		var exists bool
		err := s.db.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM recruitment_cards r
				WHERE r.id=$1
				  AND r.owner_user_id<>$2
				  AND (
						r.status IN ('open','matched')
						OR EXISTS(
							SELECT 1 FROM matches m
							WHERE m.card_id=r.id
							  AND (m.owner_user_id=$2 OR m.requester_user_id=$2)
						)
				  )
				  AND NOT EXISTS(
					SELECT 1 FROM blocks b
					WHERE (b.blocker_user_id=$2 AND b.blocked_user_id=r.owner_user_id)
					   OR (b.blocker_user_id=r.owner_user_id AND b.blocked_user_id=$2)
				  )
			)`, targetID, reporterID).Scan(&exists)
		return exists, err
	case "message":
		var exists bool
		err := s.db.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM messages msg
				JOIN chat_threads c ON c.id=msg.chat_id
				JOIN matches m ON m.id=c.match_id
				WHERE msg.id=$1
				  AND msg.deleted_at IS NULL
				  AND (m.owner_user_id=$2 OR m.requester_user_id=$2)
			)`, targetID, reporterID).Scan(&exists)
		return exists, err
	case "photo":
		var exists bool
		err := s.db.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM photos p
				WHERE p.id=$1
				  AND p.owner_user_id<>$2
				  AND p.visibility='profile'
				  AND p.deleted_at IS NULL
				  AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.owner_user_id AND u.status='active')
				UNION ALL
				SELECT 1
				FROM chat_attachments a
				JOIN chat_threads c ON c.id=a.chat_id
				JOIN matches m ON m.id=c.match_id
				WHERE a.id=$1
				  AND a.deleted_at IS NULL
				  AND (m.owner_user_id=$2 OR m.requester_user_id=$2)
			)`, targetID, reporterID).Scan(&exists)
		return exists, err
	default:
		return false, nil
	}
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

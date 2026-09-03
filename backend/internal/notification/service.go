// Package notification provides durable, localized-notification source data.
// Notification text is assembled by the client; encrypted chat plaintext never
// enters this package.
package notification

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

var (
	ErrNotificationNotFound = errors.New("notification not found")
	ErrInvalidInput         = errors.New("invalid notification input")
)

const (
	defaultListLimit = 50
	maxListLimit     = 100
)

type Type string

const (
	TypeNewApplication       Type = "new_application"
	TypeMatchConfirmed       Type = "match_confirmed"
	TypeApplicationRejected  Type = "application_rejected"
	TypeNewMessage           Type = "new_message"
	TypeApplicationWithdrawn Type = "application_withdrawn"
	TypeGuideCanceled        Type = "guide_canceled"
	TypeGuideUpdated         Type = "guide_updated"
	TypeGuideReminder        Type = "guide_reminder"
	TypeRecruitmentExpired   Type = "recruitment_expired"
)

type Destination string

const (
	DestinationApplicants        Destination = "applicants"
	DestinationApplicationDetail Destination = "application_detail"
	DestinationGuideDetail       Destination = "guide_detail"
	DestinationChat              Destination = "chat"
	DestinationRecruitmentDetail Destination = "recruitment_detail"
)

type CreateInput struct {
	UserID        string
	EventKey      string
	Type          Type
	TargetID      string
	RecruitmentID string
	Destination   Destination
	ActorName     string
	Context       string
}

type ListParams struct {
	UnreadOnly bool
	Limit      int
}

type Notification struct {
	ID            string      `json:"id"`
	Type          Type        `json:"type"`
	TargetID      string      `json:"target_id"`
	RecruitmentID string      `json:"recruitment_id,omitempty"`
	Destination   Destination `json:"destination"`
	ActorName     string      `json:"actor_name,omitempty"`
	Context       string      `json:"context,omitempty"`
	CreatedAt     string      `json:"created_at"`
	ReadAt        string      `json:"read_at,omitempty"`
}

type Service struct {
	db *sql.DB
}

func NewService(database *sql.DB) *Service {
	return &Service{db: database}
}

func (s *Service) CreateTx(ctx context.Context, tx *sql.Tx, input CreateInput, now time.Time) error {
	if s == nil || tx == nil || !validInput(input) {
		return ErrInvalidInput
	}
	id, err := randomID()
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO notifications (
			id,user_id,event_key,type,target_id,recruitment_id,destination,
			actor_name,context,created_at
		) VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,$10)
		ON CONFLICT (event_key) DO NOTHING`,
		id, strings.TrimSpace(input.UserID), strings.TrimSpace(input.EventKey), input.Type,
		strings.TrimSpace(input.TargetID), strings.TrimSpace(input.RecruitmentID), input.Destination,
		strings.TrimSpace(input.ActorName), strings.TrimSpace(input.Context), now.UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Service) List(ctx context.Context, userID string, params ListParams, now time.Time) ([]Notification, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrNotificationNotFound
	}
	limit := params.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id,type,target_id,COALESCE(recruitment_id,''),destination,
		       actor_name,context,created_at,COALESCE(read_at,'')
		FROM notifications
		WHERE user_id=$1 AND created_at>$2
		  AND ($3 = FALSE OR read_at IS NULL)
		ORDER BY created_at DESC
		LIMIT $4`,
		strings.TrimSpace(userID), now.Add(-7*24*time.Hour).UTC().Format(time.RFC3339Nano), params.UnreadOnly, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Notification, 0, limit)
	for rows.Next() {
		var item Notification
		if err := rows.Scan(
			&item.ID, &item.Type, &item.TargetID, &item.RecruitmentID, &item.Destination,
			&item.ActorName, &item.Context, &item.CreatedAt, &item.ReadAt,
		); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) MarkRead(ctx context.Context, userID, notificationID string, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(notificationID) == "" {
		return ErrInvalidInput
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE notifications SET read_at=$1
		WHERE id=$2 AND user_id=$3 AND read_at IS NULL`,
		now.UTC().Format(time.RFC3339Nano), strings.TrimSpace(notificationID), strings.TrimSpace(userID))
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM notifications WHERE id=$1 AND user_id=$2)`, notificationID, userID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotificationNotFound
		}
	}
	return nil
}

// MarkAllRead marks every unread notification retained for the authenticated
// user as read. It deliberately does not accept a notification list or user
// supplied scope, so callers cannot affect another account's notifications.
func (s *Service) MarkAllRead(ctx context.Context, userID string, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE notifications SET read_at=$1
		WHERE user_id=$2 AND read_at IS NULL`,
		now.UTC().Format(time.RFC3339Nano), strings.TrimSpace(userID))
	return err
}

func validInput(input CreateInput) bool {
	return strings.TrimSpace(input.UserID) != "" &&
		strings.TrimSpace(input.EventKey) != "" &&
		strings.TrimSpace(input.TargetID) != "" &&
		validType(input.Type) &&
		validDestination(input.Destination)
}

func validType(value Type) bool {
	switch value {
	case TypeNewApplication, TypeMatchConfirmed, TypeApplicationRejected, TypeNewMessage,
		TypeApplicationWithdrawn, TypeGuideCanceled, TypeGuideUpdated, TypeGuideReminder,
		TypeRecruitmentExpired:
		return true
	default:
		return false
	}
}

func validDestination(value Destination) bool {
	switch value {
	case DestinationApplicants, DestinationApplicationDetail, DestinationGuideDetail,
		DestinationChat, DestinationRecruitmentDetail:
		return true
	default:
		return false
	}
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

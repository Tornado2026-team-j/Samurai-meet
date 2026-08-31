package meeting

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
	ErrMeetingNotFound     = errors.New("meeting not found")
	ErrMeetingForbidden    = errors.New("meeting operation is forbidden")
	ErrMeetingBlocked      = errors.New("meeting participants are blocked")
	ErrMeetingInvalidInput = errors.New("invalid meeting input")
	ErrMeetingUnavailable  = errors.New("meeting is not available for this match")
	ErrMeetingInvalidState = errors.New("meeting state transition is invalid")
)

const (
	proximityFreshness = 5 * time.Minute
	meetingLifetime    = 6 * time.Hour
)

// Service owns short-lived meeting sessions. The native client may derive a
// coarse distance band from its local Bluetooth/GPS readings, but this service
// never receives raw coordinates, BLE identifiers, RSSI, or exact distances.
type Service struct {
	db *sql.DB
}

type Meeting struct {
	ID                 string `json:"id"`
	MatchID            string `json:"match_id"`
	Status             string `json:"status"`
	ScheduledAt        string `json:"scheduled_at,omitempty"`
	StartedAt          string `json:"started_at,omitempty"`
	EndedAt            string `json:"ended_at,omitempty"`
	ExpiresAt          string `json:"expires_at,omitempty"`
	OwnerStartedAt     string `json:"owner_started_at,omitempty"`
	RequesterStartedAt string `json:"requester_started_at,omitempty"`
	CreatedAt          string `json:"created_at"`
	UpdatedAt          string `json:"updated_at"`
}

type ProximityInput struct {
	Method       string `json:"method"`
	DistanceBand string `json:"distance_band"`
	CapturedAt   string `json:"captured_at"`
}

type ProximityObservation struct {
	UserID       string `json:"user_id"`
	Method       string `json:"method"`
	DistanceBand string `json:"distance_band"`
	CapturedAt   string `json:"captured_at"`
	UpdatedAt    string `json:"updated_at"`
	Verified     bool   `json:"verified"`
	Source       string `json:"source"`
}

func NewService(database *sql.DB) *Service {
	return &Service{db: database}
}

func (s *Service) Create(ctx context.Context, userID, matchID, scheduledAt string, now time.Time) (Meeting, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(matchID) == "" {
		return Meeting{}, ErrMeetingNotFound
	}
	if strings.TrimSpace(scheduledAt) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, scheduledAt)
		if err != nil || parsed.Before(now.Add(-24*time.Hour)) || parsed.After(now.Add(90*24*time.Hour)) {
			return Meeting{}, ErrMeetingInvalidInput
		}
		scheduledAt = parsed.UTC().Format(time.RFC3339Nano)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Meeting{}, err
	}
	defer tx.Rollback()
	ownerID, requesterID, matchStatus, err := loadMatchParticipant(ctx, tx, matchID)
	if errors.Is(err, sql.ErrNoRows) {
		return Meeting{}, ErrMeetingNotFound
	}
	if err != nil {
		return Meeting{}, err
	}
	if userID != ownerID && userID != requesterID {
		return Meeting{}, ErrMeetingForbidden
	}
	if matchStatus != "accepted" {
		return Meeting{}, ErrMeetingUnavailable
	}
	blocked, err := blockedTx(ctx, tx, ownerID, requesterID)
	if err != nil {
		return Meeting{}, err
	}
	if blocked {
		return Meeting{}, ErrMeetingBlocked
	}
	var meeting Meeting
	var existingScheduled, startedAt, endedAt, expiresAt, ownerStartedAt, requesterStartedAt sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT id,match_id,status,scheduled_at,started_at,ended_at,expires_at,owner_started_at,requester_started_at,created_at,updated_at
		FROM meeting_sessions WHERE match_id=$1 FOR UPDATE`, matchID).Scan(
		&meeting.ID, &meeting.MatchID, &meeting.Status, &existingScheduled, &startedAt, &endedAt, &expiresAt, &ownerStartedAt, &requesterStartedAt, &meeting.CreatedAt, &meeting.UpdatedAt)
	if err == nil {
		if existingScheduled.Valid {
			meeting.ScheduledAt = existingScheduled.String
		}
		if startedAt.Valid {
			meeting.StartedAt = startedAt.String
		}
		if endedAt.Valid {
			meeting.EndedAt = endedAt.String
		}
		populateMeetingTimes(&meeting, existingScheduled, startedAt, endedAt, expiresAt, ownerStartedAt, requesterStartedAt)
		if expireMeetingTx(ctx, tx, &meeting, now) || meeting.Status == "completed" || meeting.Status == "cancelled" {
			return Meeting{}, ErrMeetingInvalidState
		}
		if err = tx.Commit(); err != nil {
			return Meeting{}, err
		}
		return meeting, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Meeting{}, err
	}
	meeting.ID, err = randomID()
	if err != nil {
		return Meeting{}, err
	}
	meeting.MatchID, meeting.Status = matchID, "planned"
	meeting.ScheduledAt = scheduledAt
	meeting.CreatedAt = now.UTC().Format(time.RFC3339Nano)
	meeting.ExpiresAt = now.Add(meetingLifetime).UTC().Format(time.RFC3339Nano)
	meeting.UpdatedAt = meeting.CreatedAt
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO meeting_sessions (id,match_id,status,scheduled_at,expires_at,created_at,updated_at)
		VALUES ($1,$2,'planned',NULLIF($3,''),$4,$5,$5)`, meeting.ID, matchID, scheduledAt, meeting.ExpiresAt, meeting.CreatedAt); err != nil {
		return Meeting{}, err
	}
	if err = tx.Commit(); err != nil {
		return Meeting{}, err
	}
	return meeting, nil
}

func (s *Service) Get(ctx context.Context, userID, meetingID string) (Meeting, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Meeting{}, err
	}
	defer tx.Rollback()
	access, err := s.loadTx(ctx, tx, userID, meetingID, true)
	if err != nil {
		return Meeting{}, err
	}
	if expireMeetingTx(ctx, tx, &access.meeting, time.Now()) {
		if err := tx.Commit(); err != nil {
			return Meeting{}, err
		}
		return access.meeting, nil
	}
	if err := tx.Commit(); err != nil {
		return Meeting{}, err
	}
	return access.meeting, nil
}

func (s *Service) Start(ctx context.Context, userID, meetingID string, now time.Time) (Meeting, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Meeting{}, err
	}
	defer tx.Rollback()
	access, err := s.loadTx(ctx, tx, userID, meetingID, false)
	if err != nil {
		return Meeting{}, err
	}
	if expireMeetingTx(ctx, tx, &access.meeting, now) {
		return Meeting{}, ErrMeetingUnavailable
	}
	if access.meeting.Status != "planned" {
		return Meeting{}, ErrMeetingInvalidState
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	column := "owner_started_at"
	if userID != "" && userID != access.ownerID {
		column = "requester_started_at"
	}
	if _, err = tx.ExecContext(ctx, "UPDATE meeting_sessions SET "+column+"=COALESCE("+column+",$1),updated_at=$1 WHERE id=$2 AND status='planned'", updated, meetingID); err != nil {
		return Meeting{}, err
	}
	if column == "owner_started_at" {
		access.meeting.OwnerStartedAt = updated
	} else {
		access.meeting.RequesterStartedAt = updated
	}
	if access.meeting.OwnerStartedAt != "" && access.meeting.RequesterStartedAt != "" {
		if _, err = tx.ExecContext(ctx, "UPDATE meeting_sessions SET status='active',started_at=$1,updated_at=$1 WHERE id=$2 AND status='planned'", updated, meetingID); err != nil {
			return Meeting{}, err
		}
		access.meeting.Status, access.meeting.StartedAt = "active", updated
	}
	access.meeting.UpdatedAt = updated
	if err = tx.Commit(); err != nil {
		return Meeting{}, err
	}
	return access.meeting, nil
}

func (s *Service) End(ctx context.Context, userID, meetingID string, now time.Time) (Meeting, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Meeting{}, err
	}
	defer tx.Rollback()
	access, err := s.loadTx(ctx, tx, userID, meetingID, true)
	if err != nil {
		return Meeting{}, err
	}
	if expireMeetingTx(ctx, tx, &access.meeting, now) {
		if err := tx.Commit(); err != nil {
			return Meeting{}, err
		}
		return access.meeting, nil
	}
	if access.meeting.Status != "active" {
		return Meeting{}, ErrMeetingInvalidState
	}
	ended := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `UPDATE meeting_sessions SET status='completed',ended_at=$1,updated_at=$1 WHERE id=$2 AND status='active'`, ended, meetingID); err != nil {
		return Meeting{}, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM meeting_proximity_latest WHERE meeting_id=$1`, meetingID); err != nil {
		return Meeting{}, err
	}
	if err = tx.Commit(); err != nil {
		return Meeting{}, err
	}
	access.meeting.Status, access.meeting.EndedAt, access.meeting.UpdatedAt = "completed", ended, ended
	return access.meeting, nil
}

// Cancel revokes meeting assistance immediately even while waiting for the other participant.
func (s *Service) Cancel(ctx context.Context, userID, meetingID string, now time.Time) (Meeting, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Meeting{}, err
	}
	defer tx.Rollback()
	access, err := s.loadTx(ctx, tx, userID, meetingID, false)
	if err != nil {
		return Meeting{}, err
	}
	if access.meeting.Status != "planned" && access.meeting.Status != "active" {
		return Meeting{}, ErrMeetingInvalidState
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, "UPDATE meeting_sessions SET status='cancelled',cancelled_at=$1,updated_at=$1 WHERE id=$2", updated, meetingID); err != nil {
		return Meeting{}, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM meeting_proximity_latest WHERE meeting_id=$1", meetingID); err != nil {
		return Meeting{}, err
	}
	access.meeting.Status, access.meeting.EndedAt, access.meeting.UpdatedAt = "cancelled", updated, updated
	if err = tx.Commit(); err != nil {
		return Meeting{}, err
	}
	return access.meeting, nil
}

func (s *Service) SubmitProximity(ctx context.Context, userID, meetingID string, input ProximityInput, now time.Time) (ProximityObservation, error) {
	if err := validateProximity(input); err != nil {
		return ProximityObservation{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ProximityObservation{}, err
	}
	defer tx.Rollback()
	access, err := s.loadTx(ctx, tx, userID, meetingID, false)
	if err != nil {
		return ProximityObservation{}, err
	}
	if expireMeetingTx(ctx, tx, &access.meeting, now) {
		if err := tx.Commit(); err != nil {
			return ProximityObservation{}, err
		}
		return ProximityObservation{}, ErrMeetingUnavailable
	}
	if access.meeting.Status != "active" {
		return ProximityObservation{}, ErrMeetingInvalidState
	}
	captured := now.UTC()
	if strings.TrimSpace(input.CapturedAt) != "" {
		parsed, parseErr := time.Parse(time.RFC3339Nano, input.CapturedAt)
		if parseErr != nil || parsed.After(now.Add(2*time.Minute)) || parsed.Before(now.Add(-proximityFreshness)) {
			return ProximityObservation{}, ErrMeetingInvalidInput
		}
		captured = parsed.UTC()
	}
	capturedText := captured.Format(time.RFC3339Nano)
	updated := now.UTC().Format(time.RFC3339Nano)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO meeting_proximity_latest (meeting_id,user_id,method,distance_band,captured_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (meeting_id,user_id,method) DO UPDATE SET
			distance_band=EXCLUDED.distance_band,captured_at=EXCLUDED.captured_at,updated_at=EXCLUDED.updated_at
		WHERE EXCLUDED.captured_at >= meeting_proximity_latest.captured_at`,
		meetingID, userID, input.Method, input.DistanceBand, capturedText, updated)
	if err != nil {
		return ProximityObservation{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProximityObservation{}, err
	}
	return ProximityObservation{
		UserID: userID, Method: input.Method, DistanceBand: input.DistanceBand, CapturedAt: capturedText, UpdatedAt: updated,
		Verified: false, Source: "client_estimate",
	}, nil
}

func (s *Service) ListProximity(ctx context.Context, userID, meetingID string, now time.Time) ([]ProximityObservation, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	access, err := s.loadTx(ctx, tx, userID, meetingID, false)
	if err != nil {
		return nil, err
	}
	if expireMeetingTx(ctx, tx, &access.meeting, now) {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, ErrMeetingUnavailable
	}
	if access.meeting.Status != "active" {
		return nil, ErrMeetingInvalidState
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT user_id,method,distance_band,captured_at,updated_at
		FROM meeting_proximity_latest
		WHERE meeting_id=$1 AND captured_at>$2
		ORDER BY updated_at ASC`, meetingID, now.Add(-proximityFreshness).UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]ProximityObservation, 0, 2)
	for rows.Next() {
		var item ProximityObservation
		if err := rows.Scan(&item.UserID, &item.Method, &item.DistanceBand, &item.CapturedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Verified, item.Source = false, "client_estimate"
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

type meetingAccess struct {
	meeting Meeting
	ownerID string
}

func (s *Service) transition(ctx context.Context, userID, meetingID, from, to string, now time.Time) (Meeting, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Meeting{}, err
	}
	defer tx.Rollback()
	access, err := s.loadTx(ctx, tx, userID, meetingID, true)
	if err != nil {
		return Meeting{}, err
	}
	if access.meeting.Status != from {
		return Meeting{}, ErrMeetingInvalidState
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	if to == "active" {
		if _, err = tx.ExecContext(ctx, `UPDATE meeting_sessions SET status='active',started_at=$1,updated_at=$1 WHERE id=$2 AND status='planned'`, updated, meetingID); err != nil {
			return Meeting{}, err
		}
		access.meeting.StartedAt = updated
	}
	access.meeting.Status, access.meeting.UpdatedAt = to, updated
	if err = tx.Commit(); err != nil {
		return Meeting{}, err
	}
	return access.meeting, nil
}

func (s *Service) load(ctx context.Context, userID, meetingID string, allowCompleted bool) (meetingAccess, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(meetingID) == "" {
		return meetingAccess{}, ErrMeetingNotFound
	}
	return s.loadWithQuery(ctx, s.db, userID, meetingID, allowCompleted)
}

func (s *Service) loadTx(ctx context.Context, tx *sql.Tx, userID, meetingID string, allowCompleted bool) (meetingAccess, error) {
	return s.loadWithQuery(ctx, tx, userID, meetingID, allowCompleted)
}

type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Service) loadWithQuery(ctx context.Context, queryer rowQuerier, userID, meetingID string, allowCompleted bool) (meetingAccess, error) {
	var access meetingAccess
	var ownerID, requesterID, matchStatus string
	var scheduledAt, startedAt, endedAt, expiresAt, ownerStartedAt, requesterStartedAt sql.NullString
	query := `
		SELECT ms.id,ms.match_id,ms.status,ms.scheduled_at,ms.started_at,ms.ended_at,ms.expires_at,ms.owner_started_at,ms.requester_started_at,ms.created_at,ms.updated_at,
		       m.owner_user_id,m.requester_user_id,m.status
		FROM meeting_sessions ms JOIN matches m ON m.id=ms.match_id
		WHERE ms.id=$1`
	err := queryer.QueryRowContext(ctx, query, meetingID).Scan(&access.meeting.ID, &access.meeting.MatchID, &access.meeting.Status, &scheduledAt, &startedAt, &endedAt, &expiresAt, &ownerStartedAt, &requesterStartedAt,
		&access.meeting.CreatedAt, &access.meeting.UpdatedAt, &ownerID, &requesterID, &matchStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return meetingAccess{}, ErrMeetingNotFound
	}
	if err != nil {
		return meetingAccess{}, err
	}
	if userID != ownerID && userID != requesterID {
		return meetingAccess{}, ErrMeetingForbidden
	}
	if matchStatus != "accepted" && (!allowCompleted || matchStatus != "completed") {
		return meetingAccess{}, ErrMeetingUnavailable
	}
	access.ownerID = ownerID
	populateMeetingTimes(&access.meeting, scheduledAt, startedAt, endedAt, expiresAt, ownerStartedAt, requesterStartedAt)
	var blocked bool
	if err := queryer.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1))`, ownerID, requesterID).Scan(&blocked); err != nil {
		return meetingAccess{}, err
	}
	if blocked {
		return meetingAccess{}, ErrMeetingBlocked
	}
	return access, nil
}

func loadMatchParticipant(ctx context.Context, tx *sql.Tx, matchID string) (string, string, string, error) {
	var ownerID, requesterID, status string
	err := tx.QueryRowContext(ctx, `SELECT owner_user_id,requester_user_id,status FROM matches WHERE id=$1 FOR UPDATE`, matchID).Scan(&ownerID, &requesterID, &status)
	return ownerID, requesterID, status, err
}

func blockedTx(ctx context.Context, tx *sql.Tx, first, second string) (bool, error) {
	var blocked bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1))`, first, second).Scan(&blocked)
	return blocked, err
}

func validateProximity(input ProximityInput) error {
	input.Method = strings.TrimSpace(input.Method)
	if input.Method != "bluetooth_rssi" && input.Method != "bluetooth_uwb" && input.Method != "location_inference" {
		return ErrMeetingInvalidInput
	}
	if input.DistanceBand != "nearby" && input.DistanceBand != "short_walk" && input.DistanceBand != "far" && input.DistanceBand != "unknown" {
		return ErrMeetingInvalidInput
	}
	return nil
}

func populateMeetingTimes(m *Meeting, scheduledAt, startedAt, endedAt, expiresAt, ownerStartedAt, requesterStartedAt sql.NullString) {
	if scheduledAt.Valid {
		m.ScheduledAt = scheduledAt.String
	}
	if startedAt.Valid {
		m.StartedAt = startedAt.String
	}
	if endedAt.Valid {
		m.EndedAt = endedAt.String
	}
	if expiresAt.Valid {
		m.ExpiresAt = expiresAt.String
	}
	if ownerStartedAt.Valid {
		m.OwnerStartedAt = ownerStartedAt.String
	}
	if requesterStartedAt.Valid {
		m.RequesterStartedAt = requesterStartedAt.String
	}
}
func expireMeetingTx(ctx context.Context, tx *sql.Tx, m *Meeting, now time.Time) bool {
	if m.ExpiresAt == "" || (m.Status != "planned" && m.Status != "active") {
		return false
	}
	expires, err := time.Parse(time.RFC3339Nano, m.ExpiresAt)
	if err != nil || !expires.After(now) {
		updated := now.UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx, "UPDATE meeting_sessions SET status='cancelled',cancelled_at=$1,updated_at=$1 WHERE id=$2 AND status IN ('planned','active')", updated, m.ID); err == nil {
			_, _ = tx.ExecContext(ctx, "DELETE FROM meeting_proximity_latest WHERE meeting_id=$1", m.ID)
			m.Status = "cancelled"
			m.EndedAt = updated
			m.UpdatedAt = updated
		}
		return true
	}
	return false
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

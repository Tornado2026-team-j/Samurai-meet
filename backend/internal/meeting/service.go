package meeting

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
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
	maxSampleIDRunes   = 128
	maxDistanceM       = 1000.0
)

// Service owns short-lived meeting sessions. Bluetooth is measured by the
// native client; this service only stores a bounded, explicitly unverified
// estimate while an accepted match is actively meeting.
type Service struct {
	db *sql.DB
}

type Meeting struct {
	ID          string `json:"id"`
	MatchID     string `json:"match_id"`
	Status      string `json:"status"`
	ScheduledAt string `json:"scheduled_at,omitempty"`
	StartedAt   string `json:"started_at,omitempty"`
	EndedAt     string `json:"ended_at,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type ProximityInput struct {
	Method     string  `json:"method"`
	DistanceM  float64 `json:"distance_m"`
	Confidence float64 `json:"confidence"`
	SampleID   string  `json:"sample_id"`
	CapturedAt string  `json:"captured_at"`
}

type ProximityObservation struct {
	UserID     string  `json:"user_id"`
	Method     string  `json:"method"`
	DistanceM  float64 `json:"distance_m"`
	Confidence float64 `json:"confidence"`
	SampleID   string  `json:"sample_id"`
	CapturedAt string  `json:"captured_at"`
	UpdatedAt  string  `json:"updated_at"`
	Verified   bool    `json:"verified"`
	Source     string  `json:"source"`
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
	var existingScheduled, startedAt, endedAt sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT id,match_id,status,scheduled_at,started_at,ended_at,created_at,updated_at
		FROM meeting_sessions WHERE match_id=$1 FOR UPDATE`, matchID).Scan(
		&meeting.ID, &meeting.MatchID, &meeting.Status, &existingScheduled, &startedAt, &endedAt, &meeting.CreatedAt, &meeting.UpdatedAt)
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
		if meeting.Status == "completed" || meeting.Status == "cancelled" {
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
	meeting.UpdatedAt = meeting.CreatedAt
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO meeting_sessions (id,match_id,status,scheduled_at,created_at,updated_at)
		VALUES ($1,$2,'planned',NULLIF($3,''),$4,$4)`, meeting.ID, matchID, scheduledAt, meeting.CreatedAt); err != nil {
		return Meeting{}, err
	}
	if err = tx.Commit(); err != nil {
		return Meeting{}, err
	}
	return meeting, nil
}

func (s *Service) Get(ctx context.Context, userID, meetingID string) (Meeting, error) {
	access, err := s.load(ctx, userID, meetingID, true)
	if err != nil {
		return Meeting{}, err
	}
	return access.meeting, nil
}

func (s *Service) Start(ctx context.Context, userID, meetingID string, now time.Time) (Meeting, error) {
	return s.transition(ctx, userID, meetingID, "planned", "active", now)
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

func (s *Service) SubmitProximity(ctx context.Context, userID, meetingID string, input ProximityInput, now time.Time) (ProximityObservation, error) {
	if err := validateProximity(input); err != nil {
		return ProximityObservation{}, err
	}
	access, err := s.load(ctx, userID, meetingID, false)
	if err != nil {
		return ProximityObservation{}, err
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
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO meeting_proximity_latest (meeting_id,user_id,method,distance_m,confidence,sample_id,captured_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (meeting_id,user_id,method) DO UPDATE SET
			distance_m=EXCLUDED.distance_m,confidence=EXCLUDED.confidence,
			sample_id=EXCLUDED.sample_id,captured_at=EXCLUDED.captured_at,updated_at=EXCLUDED.updated_at
		WHERE EXCLUDED.captured_at >= meeting_proximity_latest.captured_at`,
		meetingID, userID, input.Method, input.DistanceM, input.Confidence, input.SampleID, capturedText, updated)
	if err != nil {
		return ProximityObservation{}, err
	}
	return ProximityObservation{
		UserID: userID, Method: input.Method, DistanceM: input.DistanceM, Confidence: input.Confidence,
		SampleID: input.SampleID, CapturedAt: capturedText, UpdatedAt: updated,
		Verified: false, Source: "client_estimate",
	}, nil
}

func (s *Service) ListProximity(ctx context.Context, userID, meetingID string, now time.Time) ([]ProximityObservation, error) {
	access, err := s.load(ctx, userID, meetingID, false)
	if err != nil {
		return nil, err
	}
	if access.meeting.Status != "active" {
		return nil, ErrMeetingInvalidState
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT user_id,method,distance_m,confidence,sample_id,captured_at,updated_at
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
		if err := rows.Scan(&item.UserID, &item.Method, &item.DistanceM, &item.Confidence, &item.SampleID, &item.CapturedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Verified, item.Source = false, "client_estimate"
		result = append(result, item)
	}
	return result, rows.Err()
}

type meetingAccess struct {
	meeting Meeting
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
	var scheduledAt, startedAt, endedAt sql.NullString
	query := `
		SELECT ms.id,ms.match_id,ms.status,ms.scheduled_at,ms.started_at,ms.ended_at,ms.created_at,ms.updated_at,
		       m.owner_user_id,m.requester_user_id,m.status
		FROM meeting_sessions ms JOIN matches m ON m.id=ms.match_id
		WHERE ms.id=$1`
	err := queryer.QueryRowContext(ctx, query, meetingID).Scan(&access.meeting.ID, &access.meeting.MatchID, &access.meeting.Status, &scheduledAt, &startedAt, &endedAt,
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
	if scheduledAt.Valid {
		access.meeting.ScheduledAt = scheduledAt.String
	}
	if startedAt.Valid {
		access.meeting.StartedAt = startedAt.String
	}
	if endedAt.Valid {
		access.meeting.EndedAt = endedAt.String
	}
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
	input.SampleID = strings.TrimSpace(input.SampleID)
	if input.Method != "bluetooth_rssi" && input.Method != "bluetooth_uwb" && input.Method != "location_inference" {
		return ErrMeetingInvalidInput
	}
	if !finite(input.DistanceM) || input.DistanceM < 0 || input.DistanceM > maxDistanceM ||
		!finite(input.Confidence) || input.Confidence < 0 || input.Confidence > 1 ||
		!validSampleID(input.SampleID) {
		return ErrMeetingInvalidInput
	}
	return nil
}

func validSampleID(value string) bool {
	if value == "" || !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxSampleIDRunes {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

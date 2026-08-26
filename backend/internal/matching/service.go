// Package matching provides recruitment-card search and matching services.
package matching

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrInvalidCard       = errors.New("invalid recruitment card")
	ErrCardNotFound      = errors.New("recruitment card not found")
	ErrCardNotOpen       = errors.New("recruitment card is not open")
	ErrOwnCard           = errors.New("cannot send interest to your own card")
	ErrDuplicateInterest = errors.New("interest already sent for this card")
	ErrBlocked           = errors.New("a block between these users prevents this action")
	ErrMatchNotFound     = errors.New("match not found")
	ErrNotCardOwner      = errors.New("only the card owner can accept this match")
	ErrMatchNotPending   = errors.New("match is not pending")
	ErrInvalidBlock      = errors.New("invalid block request")
)

var validDistances = map[int]bool{1: true, 3: true, 5: true}

const cardColumns = `id,owner_user_id,activity,location_label,available_date,start_time,duration_hours,distance_km,status,created_at,updated_at`

type Service struct {
	db *sql.DB
}

func NewService(database *sql.DB) *Service { return &Service{db: database} }

func validCardInput(ownerUserID, activity, availableDate, startTime string, durationHours, distanceKm int) bool {
	return strings.TrimSpace(ownerUserID) != "" &&
		strings.TrimSpace(activity) != "" &&
		strings.TrimSpace(availableDate) != "" &&
		strings.TrimSpace(startTime) != "" &&
		durationHours > 0 &&
		validDistances[distanceKm]
}

// CreateCard persists a recruitment card directly in the open state. The
// draft -> open publish workflow described in docs/features/matching.md is
// deferred; only the fields needed to gate matching exist today.
func (s *Service) CreateCard(ctx context.Context, ownerUserID, activity, locationLabel, availableDate, startTime string, durationHours, distanceKm int, now time.Time) (RecruitmentCard, error) {
	if s == nil || s.db == nil || !validCardInput(ownerUserID, activity, availableDate, startTime, durationHours, distanceKm) {
		return RecruitmentCard{}, ErrInvalidCard
	}
	nowText := now.UTC().Format(time.RFC3339Nano)
	card := RecruitmentCard{
		ID:            newID(),
		OwnerUserID:   strings.TrimSpace(ownerUserID),
		Activity:      strings.TrimSpace(activity),
		LocationLabel: strings.TrimSpace(locationLabel),
		AvailableDate: strings.TrimSpace(availableDate),
		StartTime:     strings.TrimSpace(startTime),
		DurationHours: durationHours,
		DistanceKm:    distanceKm,
		Status:        CardStatusOpen,
		CreatedAt:     now.UTC(),
		UpdatedAt:     now.UTC(),
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,activity,location_label,available_date,start_time,duration_hours,distance_km,status,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
		card.ID, card.OwnerUserID, card.Activity, nullableString(card.LocationLabel), card.AvailableDate, card.StartTime, card.DurationHours, card.DistanceKm, string(card.Status), nowText)
	if err != nil {
		return RecruitmentCard{}, err
	}
	return card, nil
}

func (s *Service) GetCard(ctx context.Context, cardID string) (RecruitmentCard, error) {
	if s == nil || s.db == nil || strings.TrimSpace(cardID) == "" {
		return RecruitmentCard{}, ErrCardNotFound
	}
	return scanCard(s.db.QueryRowContext(ctx, `SELECT `+cardColumns+` FROM recruitment_cards WHERE id=$1`, cardID))
}

// ListOwnedCards returns the cards a user created, most recent first. Public
// discovery (keyword/radius search) is out of scope for this phase.
func (s *Service) ListOwnedCards(ctx context.Context, ownerUserID string) ([]RecruitmentCard, error) {
	if s == nil || s.db == nil || strings.TrimSpace(ownerUserID) == "" {
		return nil, ErrInvalidCard
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+cardColumns+` FROM recruitment_cards WHERE owner_user_id=$1 ORDER BY created_at DESC`, ownerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]RecruitmentCard, 0)
	for rows.Next() {
		card, err := scanCardRow(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, card)
	}
	return cards, rows.Err()
}

// SendInterest records that interestedUserID wants to join cardID's owner.
// It enforces: the card must be open, the caller cannot be the owner, no
// block may exist between the two users, and the same user cannot send
// interest to the same card twice.
func (s *Service) SendInterest(ctx context.Context, cardID, interestedUserID string, now time.Time) (Match, error) {
	if s == nil || s.db == nil || strings.TrimSpace(cardID) == "" || strings.TrimSpace(interestedUserID) == "" {
		return Match{}, ErrInvalidCard
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()

	var ownerUserID, status string
	err = tx.QueryRowContext(ctx, `SELECT owner_user_id,status FROM recruitment_cards WHERE id=$1 FOR UPDATE`, cardID).Scan(&ownerUserID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrCardNotFound
	}
	if err != nil {
		return Match{}, err
	}
	if status != string(CardStatusOpen) {
		return Match{}, ErrCardNotOpen
	}
	if ownerUserID == interestedUserID {
		return Match{}, ErrOwnCard
	}
	blocked, err := blockExists(ctx, tx, ownerUserID, interestedUserID)
	if err != nil {
		return Match{}, err
	}
	if blocked {
		return Match{}, ErrBlocked
	}

	nowText := now.UTC().Format(time.RFC3339Nano)
	match := Match{
		ID:                newID(),
		RecruitmentCardID: cardID,
		OwnerUserID:       ownerUserID,
		InterestedUserID:  interestedUserID,
		Status:            MatchStatusPending,
		CreatedAt:         now.UTC(),
		UpdatedAt:         now.UTC(),
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO matches (id,recruitment_card_id,owner_user_id,interested_user_id,status,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$6)`,
		match.ID, match.RecruitmentCardID, match.OwnerUserID, match.InterestedUserID, string(match.Status), nowText)
	if err != nil {
		if isUniqueViolation(err) {
			return Match{}, ErrDuplicateInterest
		}
		return Match{}, err
	}
	if err = tx.Commit(); err != nil {
		return Match{}, err
	}
	return match, nil
}

// AcceptMatch is called by the card owner. It moves the match to accepted
// (which is what gates chat access) and marks the card matched, stopping
// further interest. Whether a card may accept more than one match is an open
// question in docs/features/matching.md; this phase picks "no" as the
// simplest default and can be revisited.
func (s *Service) AcceptMatch(ctx context.Context, matchID, callerUserID string, now time.Time) (Match, error) {
	if s == nil || s.db == nil || strings.TrimSpace(matchID) == "" || strings.TrimSpace(callerUserID) == "" {
		return Match{}, ErrMatchNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()

	var match Match
	var cardID, ownerUserID, interestedUserID, status, createdAt string
	err = tx.QueryRowContext(ctx, `SELECT recruitment_card_id,owner_user_id,interested_user_id,status,created_at FROM matches WHERE id=$1 FOR UPDATE`, matchID).
		Scan(&cardID, &ownerUserID, &interestedUserID, &status, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrMatchNotFound
	}
	if err != nil {
		return Match{}, err
	}
	if ownerUserID != callerUserID {
		return Match{}, ErrNotCardOwner
	}
	if status != string(MatchStatusPending) {
		return Match{}, ErrMatchNotPending
	}

	nowText := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `UPDATE matches SET status='accepted',updated_at=$1 WHERE id=$2`, nowText, matchID); err != nil {
		return Match{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE recruitment_cards SET status='matched',updated_at=$1 WHERE id=$2`, nowText, cardID); err != nil {
		return Match{}, err
	}
	if err = tx.Commit(); err != nil {
		return Match{}, err
	}

	match = Match{
		ID:                matchID,
		RecruitmentCardID: cardID,
		OwnerUserID:       ownerUserID,
		InterestedUserID:  interestedUserID,
		Status:            MatchStatusAccepted,
		UpdatedAt:         now.UTC(),
	}
	if match.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return Match{}, err
	}
	return match, nil
}

// ListAcceptedMatches returns every accepted match involving userID, on
// either side of the pairing. The chat feature will use this to gate access
// and to build the chat list.
func (s *Service) ListAcceptedMatches(ctx context.Context, userID string) ([]Match, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrMatchNotFound
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,recruitment_card_id,owner_user_id,interested_user_id,status,created_at,updated_at
		FROM matches
		WHERE status='accepted' AND (owner_user_id=$1 OR interested_user_id=$1)
		ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	matches := make([]Match, 0)
	for rows.Next() {
		var match Match
		var status, createdAt, updatedAt string
		if err := rows.Scan(&match.ID, &match.RecruitmentCardID, &match.OwnerUserID, &match.InterestedUserID, &status, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		match.Status = MatchStatus(status)
		if match.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
			return nil, err
		}
		if match.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
			return nil, err
		}
		matches = append(matches, match)
	}
	return matches, rows.Err()
}

// IsMatched reports whether userA and userB have an accepted match, which is
// the access-control check the chat feature needs before opening a chat.
func (s *Service) IsMatched(ctx context.Context, userA, userB string) (bool, error) {
	if s == nil || s.db == nil {
		return false, ErrMatchNotFound
	}
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM matches
			WHERE status='accepted'
			AND ((owner_user_id=$1 AND interested_user_id=$2) OR (owner_user_id=$2 AND interested_user_id=$1))
		)`, userA, userB).Scan(&exists)
	return exists, err
}

// CreateBlock is idempotent: blocking the same user twice is a no-op.
func (s *Service) CreateBlock(ctx context.Context, blockerUserID, blockedUserID string, now time.Time) error {
	blockerUserID = strings.TrimSpace(blockerUserID)
	blockedUserID = strings.TrimSpace(blockedUserID)
	if s == nil || s.db == nil || blockerUserID == "" || blockedUserID == "" || blockerUserID == blockedUserID {
		return ErrInvalidBlock
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO blocks (id,blocker_user_id,blocked_user_id,created_at)
		VALUES ($1,$2,$3,$4) ON CONFLICT (blocker_user_id,blocked_user_id) DO NOTHING`,
		newID(), blockerUserID, blockedUserID, now.UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Service) RemoveBlock(ctx context.Context, blockerUserID, blockedUserID string) error {
	if s == nil || s.db == nil || strings.TrimSpace(blockerUserID) == "" || strings.TrimSpace(blockedUserID) == "" {
		return ErrInvalidBlock
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2`, blockerUserID, blockedUserID)
	return err
}

func (s *Service) ListBlocks(ctx context.Context, blockerUserID string) ([]string, error) {
	if s == nil || s.db == nil || strings.TrimSpace(blockerUserID) == "" {
		return nil, ErrInvalidBlock
	}
	rows, err := s.db.QueryContext(ctx, `SELECT blocked_user_id FROM blocks WHERE blocker_user_id=$1 ORDER BY created_at DESC`, blockerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	blocked := make([]string, 0)
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		blocked = append(blocked, userID)
	}
	return blocked, rows.Err()
}

// IsBlocked reports whether a block exists in either direction between the
// two users.
func (s *Service) IsBlocked(ctx context.Context, userA, userB string) (bool, error) {
	if s == nil || s.db == nil {
		return false, ErrInvalidBlock
	}
	return blockExists(ctx, s.db, userA, userB)
}

type querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func blockExists(ctx context.Context, q querier, userA, userB string) (bool, error) {
	var exists bool
	err := q.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM blocks
			WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)
		)`, userA, userB).Scan(&exists)
	return exists, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanCard(row rowScanner) (RecruitmentCard, error) {
	card, err := scanCardRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return RecruitmentCard{}, ErrCardNotFound
	}
	return card, err
}

func scanCardRow(row rowScanner) (RecruitmentCard, error) {
	var card RecruitmentCard
	var locationLabel sql.NullString
	var status, createdAt, updatedAt string
	err := row.Scan(&card.ID, &card.OwnerUserID, &card.Activity, &locationLabel, &card.AvailableDate, &card.StartTime, &card.DurationHours, &card.DistanceKm, &status, &createdAt, &updatedAt)
	if err != nil {
		return RecruitmentCard{}, err
	}
	card.LocationLabel = locationLabel.String
	card.Status = CardStatus(status)
	if card.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return RecruitmentCard{}, err
	}
	if card.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
		return RecruitmentCard{}, err
	}
	return card, nil
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func newID() string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

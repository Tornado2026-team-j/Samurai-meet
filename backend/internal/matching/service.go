package matching

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
)

var (
	ErrRecruitmentNotFound = errors.New("recruitment not found")
	ErrMatchNotFound       = errors.New("match not found")
	ErrForbidden           = errors.New("matching operation is forbidden")
	ErrInvalidInput        = errors.New("invalid matching input")
	ErrProfileIncomplete   = errors.New("profile is incomplete")
	ErrDuplicateInterest   = errors.New("interest already exists")
	ErrRecruitmentExpired  = errors.New("recruitment is expired")
	ErrInvalidState        = errors.New("matching state transition is invalid")
	ErrBlocked             = errors.New("users are blocked")
)

const (
	defaultSearchLimit   = 20
	maxSearchLimit       = 50
	maxKeywords          = 20
	maxKeywordRunes      = 80
	maxDescriptionRunes  = 2000
	maxLocationNameRunes = 120
	maxParticipantLimit  = 10
	maxSearchRangeMonths = 2
	locationTTL          = time.Hour
	recruitmentLeadTime  = 24 * time.Hour
	recruitmentTimezone  = "Asia/Tokyo"
)

const (
	categoryFood     = "Food"
	categoryPlaces   = "Places"
	categoryActivity = "Activity"
	categoryOther    = "Other"
)

// recruitmentLocation is deliberately fixed at Japan Standard Time. The
// recruitment API is Japan-only, so date and clock fields must not depend on
// the server's local timezone database or process timezone.
var recruitmentLocation = time.FixedZone(recruitmentTimezone, 9*60*60)

// Service owns recruitment, interest, and match state transitions. Exact
// locations stay in the database and are never included in API responses.
type Service struct {
	db            *sql.DB
	notifications *notification.Service
}

type Recruitment struct {
	ID                 string   `json:"id"`
	Category           string   `json:"category"`
	AuthorName         string   `json:"author_name"`
	NationalityCode    string   `json:"nationality_code"`
	Rating             float64  `json:"rating"`
	AvailableDate      string   `json:"available_date"`
	StartTime          string   `json:"start_time"`
	EndTime            string   `json:"end_time"`
	Timezone           string   `json:"timezone"`
	DurationHours      float64  `json:"duration_hours"`
	Keywords           []string `json:"keywords"`
	Description        string   `json:"description"`
	LocationName       string   `json:"location_name"`
	ParticipantLimit   int      `json:"participant_limit"`
	VisibilityRadiusKM int      `json:"visibility_radius_km"`
	DistanceBand       string   `json:"distance_band,omitempty"`
	Status             string   `json:"status"`
	ExpiresAt          string   `json:"expires_at"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
}

type Match struct {
	ID            string `json:"id"`
	RecruitmentID string `json:"recruitment_id"`
	Status        string `json:"status"`
	MatchedAt     string `json:"matched_at,omitempty"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

// PublicProfile contains only the profile fields that are needed while
// reviewing a match. Server-managed fields such as the exact location are
// deliberately not part of this response.
type PublicProfile struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	NationalityCode string `json:"nationality_code"`
	Bio             string `json:"bio"`
	IdentityStatus  string `json:"identity_status"`
	LikesCount      int    `json:"likes_count"`
}

// MatchView is returned to either participant of a match. OtherUser is
// relative to the authenticated user, so the same endpoint can serve both
// the recruiter's application list and the applicant's match list.
type MatchView struct {
	Match
	OtherUser   PublicProfile `json:"other_user"`
	Recruitment Recruitment   `json:"recruitment"`
	LikedByMe   bool          `json:"liked_by_me"`
}

// MatchLike is the authenticated participant's one-way appreciation for the
// other participant after their scheduled plan has ended.
type MatchLike struct {
	MatchID string `json:"match_id"`
	Liked   bool   `json:"liked"`
	LikedAt string `json:"liked_at"`
}

type MatchListParams struct {
	Role   string
	Status string
	Limit  int
}

type RecruitmentInput struct {
	Category           string   `json:"category"`
	AvailableDate      string   `json:"available_date"`
	StartTime          string   `json:"start_time"`
	EndTime            string   `json:"end_time"`
	Timezone           string   `json:"timezone"`
	Keywords           []string `json:"keywords"`
	Description        string   `json:"description"`
	LocationName       string   `json:"location_name"`
	ParticipantLimit   int      `json:"participant_limit"`
	VisibilityRadiusKM int      `json:"visibility_radius_km"`
	Latitude           *float64 `json:"latitude"`
	Longitude          *float64 `json:"longitude"`
	LocationAccuracyM  *float64 `json:"location_accuracy_m"`
	Status             string   `json:"status"`
}

type RecruitmentPatch struct {
	Category           *string   `json:"category"`
	AvailableDate      *string   `json:"available_date"`
	StartTime          *string   `json:"start_time"`
	EndTime            *string   `json:"end_time"`
	Timezone           *string   `json:"timezone"`
	Keywords           *[]string `json:"keywords"`
	Description        *string   `json:"description"`
	LocationName       *string   `json:"location_name"`
	ParticipantLimit   *int      `json:"participant_limit"`
	VisibilityRadiusKM *int      `json:"visibility_radius_km"`
	Latitude           *float64  `json:"latitude"`
	Longitude          *float64  `json:"longitude"`
	LocationAccuracyM  *float64  `json:"location_accuracy_m"`
	ClearLocation      bool      `json:"clear_location"`
	Status             *string   `json:"status"`
}

type SearchParams struct {
	Keywords      []string
	Category      string
	AvailableDate string
	AvailableFrom string
	AvailableTo   string
	StartTime     string
	EndTime       string
	RadiusKM      int
	VerifiedOnly  bool
	Latitude      *float64
	Longitude     *float64
	Limit         int
}

type LocationInput struct {
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	AccuracyM  float64 `json:"accuracy_m"`
	CapturedAt string  `json:"captured_at"`
}

type cardRecord struct {
	ID                 string
	OwnerUserID        string
	Category           string
	AuthorName         string
	NationalityCode    string
	AvailableDate      string
	StartTime          string
	EndTime            string
	Timezone           string
	KeywordsJSON       string
	Description        string
	LocationName       string
	ParticipantLimit   int
	VisibilityRadiusKM int
	Latitude           sql.NullFloat64
	Longitude          sql.NullFloat64
	LocationAccuracyM  sql.NullFloat64
	Status             string
	ExpiresAt          string
	CreatedAt          string
	UpdatedAt          string
	IdentityStatus     string
}

type searchItem struct {
	item     Recruitment
	distance float64
}

type matchRecord struct {
	ID            string
	RecruitmentID string
	RequesterID   string
	OwnerID       string
	Status        string
	MatchedAt     sql.NullString
	CreatedAt     string
	UpdatedAt     string
	LikedByMe     bool
}

func NewService(database *sql.DB, notificationServices ...*notification.Service) *Service {
	var notifications *notification.Service
	if len(notificationServices) > 0 {
		notifications = notificationServices[0]
	}
	return &Service{db: database, notifications: notifications}
}

func (s *Service) CreateRecruitment(ctx context.Context, userID string, input RecruitmentInput, now time.Time) (Recruitment, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return Recruitment{}, ErrRecruitmentNotFound
	}
	normalized, expiresAt, err := normalizeRecruitmentInput(input, now)
	if err != nil {
		return Recruitment{}, err
	}
	if normalized.Status == "open" {
		complete, checkErr := s.profileComplete(ctx, userID)
		if checkErr != nil {
			return Recruitment{}, checkErr
		}
		if !complete {
			return Recruitment{}, ErrProfileIncomplete
		}
	}
	keywordsJSON, err := json.Marshal(normalized.Keywords)
	if err != nil {
		return Recruitment{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	id, err := newID()
	if err != nil {
		return Recruitment{}, err
	}
	if _, err = s.db.ExecContext(ctx, `
		INSERT INTO recruitment_cards (
			id, owner_user_id, category, available_date, start_time, end_time,
			timezone, keywords_json, description, location_name, participant_limit, visibility_radius_km,
			latitude, longitude, location_accuracy_m, status, expires_at,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
		id, userID, normalized.Category, normalized.AvailableDate, normalized.StartTime,
		normalized.EndTime, normalized.Timezone, string(keywordsJSON), normalized.Description,
		normalized.LocationName, normalized.ParticipantLimit, normalized.VisibilityRadiusKM,
		nullableFloat(normalized.Latitude), nullableFloat(normalized.Longitude),
		nullableFloat(normalized.LocationAccuracyM), normalized.Status, expiresAt, created); err != nil {
		return Recruitment{}, err
	}
	return s.GetRecruitment(ctx, userID, id, now)
}

func (s *Service) SearchRecruitments(ctx context.Context, userID string, params SearchParams, now time.Time) ([]Recruitment, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrRecruitmentNotFound
	}
	params, err := normalizeSearchParams(params)
	if err != nil {
		return nil, err
	}
	if params.Latitude == nil && params.Longitude == nil {
		params.Latitude, params.Longitude = s.currentLocation(ctx, userID, now)
	}
	nowText := now.UTC().Format(time.RFC3339Nano)
	// Keyword and exact distance matching is finalized below in Go. Do not cap
	// this candidate query before those filters run: doing so would make the
	// page boundary depend on unrelated newer cards.
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.owner_user_id, r.category, COALESCE(p.name,''),
		       COALESCE(p.nationality_code,''), r.available_date, r.start_time,
		       r.end_time, r.timezone, r.keywords_json, r.description,
		       r.location_name, r.participant_limit, r.visibility_radius_km, r.latitude, r.longitude,
		       r.location_accuracy_m, r.status, r.expires_at, r.created_at,
		       r.updated_at, COALESCE(p.identity_status,'unverified')
		FROM recruitment_cards r
		JOIN users u ON u.id = r.owner_user_id AND u.status = 'active'
		LEFT JOIN profiles p ON p.user_id = r.owner_user_id
		WHERE r.owner_user_id <> $1
		  AND r.status IN ('open','matched')
		  AND r.expires_at > $2
		  AND ($3 = '' OR r.category = $3)
		  AND ($4 = '' OR r.available_date = $4)
		  AND ($5 = '' OR r.available_date >= $5)
		  AND ($6 = '' OR r.available_date <= $6)
		  AND ($7 = '' OR (r.start_time < $8 AND r.end_time > $7))
		  AND ($9 = false OR COALESCE(p.identity_status,'unverified') = 'verified')
		  AND (SELECT COUNT(*) FROM matches accepted WHERE accepted.card_id=r.id AND accepted.status='accepted') < r.participant_limit
		  AND NOT EXISTS (
				SELECT 1 FROM blocks b
				WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = r.owner_user_id)
				   OR (b.blocker_user_id = r.owner_user_id AND b.blocked_user_id = $1)
		  )
		ORDER BY r.created_at DESC`, userID, nowText, params.Category, params.AvailableDate,
		params.AvailableFrom, params.AvailableTo, params.StartTime, params.EndTime, params.VerifiedOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	itemCap := params.Limit
	if itemCap < 0 {
		itemCap = 0
	}
	if itemCap > maxSearchLimit {
		itemCap = maxSearchLimit
	}
	items := make([]searchItem, 0, itemCap)
	for rows.Next() {
		var record cardRecord
		if err = rows.Scan(
			&record.ID, &record.OwnerUserID, &record.Category, &record.AuthorName,
			&record.NationalityCode, &record.AvailableDate, &record.StartTime,
			&record.EndTime, &record.Timezone, &record.KeywordsJSON, &record.Description,
			&record.LocationName, &record.ParticipantLimit,
			&record.VisibilityRadiusKM, &record.Latitude, &record.Longitude,
			&record.LocationAccuracyM, &record.Status, &record.ExpiresAt, &record.CreatedAt,
			&record.UpdatedAt, &record.IdentityStatus,
		); err != nil {
			return nil, err
		}
		keywords, decodeErr := decodeKeywords(record.KeywordsJSON)
		if decodeErr != nil || !matchesKeywords(keywords, params.Keywords) ||
			(params.Category != "" && record.Category != params.Category) ||
			!matchesDateAndTime(record, params) || (params.VerifiedOnly && record.IdentityStatus != "verified") {
			continue
		}
		distance, hasDistance := distanceFor(record, params.Latitude, params.Longitude)
		if params.Latitude != nil {
			if !hasDistance || distance > float64(record.VisibilityRadiusKM) ||
				(params.RadiusKM > 0 && distance > float64(params.RadiusKM)) {
				continue
			}
		}
		items = append(items, searchItem{
			item:     buildRecruitment(record, keywords, distanceBand(distance, hasDistance)),
			distance: distance,
		})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if params.Latitude != nil {
		sort.SliceStable(items, func(i, j int) bool {
			return items[i].distance < items[j].distance
		})
	}
	if len(items) > params.Limit {
		items = items[:params.Limit]
	}
	result := make([]Recruitment, 0, len(items))
	for _, item := range items {
		result = append(result, item.item)
	}
	return result, nil
}

// ListOwnedRecruitments returns every recruitment owned by the authenticated
// user, including drafts and closed or expired history. It is intentionally a
// separate operation from public search, which must never include the caller's
// own cards.
func (s *Service) ListOwnedRecruitments(ctx context.Context, userID string, now time.Time) ([]Recruitment, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrRecruitmentNotFound
	}
	nowText := now.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx, `
		UPDATE recruitment_cards SET status='expired',updated_at=$1
		WHERE owner_user_id=$2 AND status IN ('open','matched') AND expires_at <= $1`, nowText, userID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.owner_user_id, r.category, COALESCE(p.name,''),
		       COALESCE(p.nationality_code,''), r.available_date, r.start_time,
		       r.end_time, r.timezone, r.keywords_json, r.description,
		       r.location_name, r.participant_limit, r.visibility_radius_km, r.latitude, r.longitude,
		       r.location_accuracy_m, r.status, r.expires_at, r.created_at,
		       r.updated_at, COALESCE(p.identity_status,'unverified')
		FROM recruitment_cards r
		JOIN users u ON u.id=r.owner_user_id AND u.status='active'
		LEFT JOIN profiles p ON p.user_id=r.owner_user_id
		WHERE r.owner_user_id=$1
		ORDER BY r.updated_at DESC
		LIMIT $2`, userID, maxSearchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Recruitment, 0, maxSearchLimit)
	for rows.Next() {
		var record cardRecord
		if err = rows.Scan(
			&record.ID, &record.OwnerUserID, &record.Category, &record.AuthorName,
			&record.NationalityCode, &record.AvailableDate, &record.StartTime,
			&record.EndTime, &record.Timezone, &record.KeywordsJSON, &record.Description,
			&record.LocationName, &record.ParticipantLimit,
			&record.VisibilityRadiusKM, &record.Latitude, &record.Longitude,
			&record.LocationAccuracyM, &record.Status, &record.ExpiresAt, &record.CreatedAt,
			&record.UpdatedAt, &record.IdentityStatus,
		); err != nil {
			return nil, err
		}
		keywords, decodeErr := decodeKeywords(record.KeywordsJSON)
		if decodeErr != nil {
			return nil, decodeErr
		}
		result = append(result, buildRecruitment(record, keywords, ""))
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) GetRecruitment(ctx context.Context, userID, recruitmentID string, now time.Time) (Recruitment, error) {
	record, err := s.loadCard(ctx, recruitmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return Recruitment{}, ErrRecruitmentNotFound
	}
	if err != nil {
		return Recruitment{}, err
	}
	if record.OwnerUserID != userID {
		blocked, blockErr := s.blocked(ctx, userID, record.OwnerUserID)
		if blockErr != nil {
			return Recruitment{}, blockErr
		}
		if blocked || (record.Status != "open" && record.Status != "matched") || !beforeExpiry(record.ExpiresAt, now) {
			return Recruitment{}, ErrRecruitmentNotFound
		}
	} else if !beforeExpiry(record.ExpiresAt, now) && (record.Status == "open" || record.Status == "matched") {
		if _, err = s.db.ExecContext(ctx, `UPDATE recruitment_cards SET status='expired',updated_at=$1 WHERE id=$2 AND status IN ('open','matched')`, now.UTC().Format(time.RFC3339Nano), recruitmentID); err != nil {
			return Recruitment{}, err
		}
		record.Status = "expired"
	}
	keywords, err := decodeKeywords(record.KeywordsJSON)
	if err != nil {
		return Recruitment{}, err
	}
	return buildRecruitment(record, keywords, ""), nil
}

func (s *Service) UpdateRecruitment(ctx context.Context, userID, recruitmentID string, patch RecruitmentPatch, now time.Time) (Recruitment, error) {
	record, err := s.loadCard(ctx, recruitmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return Recruitment{}, ErrRecruitmentNotFound
	}
	if err != nil {
		return Recruitment{}, err
	}
	if record.OwnerUserID != userID {
		return Recruitment{}, ErrForbidden
	}
	if record.Status == "expired" || record.Status == "completed" || record.Status == "closed" {
		return Recruitment{}, ErrInvalidState
	}
	if record.Status == "matched" && changesRecruitmentContent(patch) {
		return Recruitment{}, ErrInvalidState
	}
	keywords, err := decodeKeywords(record.KeywordsJSON)
	if err != nil {
		return Recruitment{}, err
	}
	latitude, longitude, accuracy := nullableValue(record.Latitude), nullableValue(record.Longitude), nullableValue(record.LocationAccuracyM)
	if patch.ClearLocation {
		latitude, longitude, accuracy = nil, nil, nil
	}
	input := RecruitmentInput{
		Category:           record.Category,
		AvailableDate:      record.AvailableDate,
		StartTime:          record.StartTime,
		EndTime:            record.EndTime,
		Timezone:           record.Timezone,
		Keywords:           keywords,
		Description:        record.Description,
		LocationName:       record.LocationName,
		ParticipantLimit:   record.ParticipantLimit,
		VisibilityRadiusKM: record.VisibilityRadiusKM,
		Latitude:           latitude,
		Longitude:          longitude,
		LocationAccuracyM:  accuracy,
		Status:             record.Status,
	}
	applyPatch(&input, patch)
	normalized, expiresAt, err := normalizeRecruitmentInput(input, now)
	if err != nil {
		return Recruitment{}, err
	}
	if normalized.Status == "open" {
		complete, checkErr := s.profileComplete(ctx, userID)
		if checkErr != nil {
			return Recruitment{}, checkErr
		}
		if !complete {
			return Recruitment{}, ErrProfileIncomplete
		}
	}
	keywordsJSON, err := json.Marshal(normalized.Keywords)
	if err != nil {
		return Recruitment{}, err
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `
		UPDATE recruitment_cards SET
			category=$1, available_date=$2, start_time=$3, end_time=$4,
			timezone=$5, keywords_json=$6, description=$7, location_name=$8,
			participant_limit=$9, visibility_radius_km=$10,
			latitude=$11, longitude=$12, location_accuracy_m=$13, status=$14,
			expires_at=$15, updated_at=$16
		WHERE id=$17 AND owner_user_id=$18`, normalized.Category, normalized.AvailableDate,
		normalized.StartTime, normalized.EndTime, normalized.Timezone, string(keywordsJSON),
		normalized.Description, normalized.LocationName, normalized.ParticipantLimit,
		normalized.VisibilityRadiusKM, nullableFloat(normalized.Latitude),
		nullableFloat(normalized.Longitude), nullableFloat(normalized.LocationAccuracyM),
		normalized.Status, expiresAt, updated, recruitmentID, userID)
	if err != nil {
		return Recruitment{}, err
	}
	return s.GetRecruitment(ctx, userID, recruitmentID, now)
}

func (s *Service) CloseRecruitment(ctx context.Context, userID, recruitmentID string, now time.Time) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE recruitment_cards SET status='closed',updated_at=$1
		WHERE id=$2 AND owner_user_id=$3 AND status NOT IN ('expired','completed')`,
		now.UTC().Format(time.RFC3339Nano), recruitmentID, userID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrRecruitmentNotFound
	}
	return nil
}

func (s *Service) SendInterest(ctx context.Context, userID, recruitmentID string, now time.Time) (Match, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()
	var ownerID, status, expiresAt, description string
	var participantLimit int
	if err = tx.QueryRowContext(ctx, `
		SELECT owner_user_id,status,expires_at,description,participant_limit FROM recruitment_cards
		WHERE id=$1 FOR UPDATE`, recruitmentID).Scan(&ownerID, &status, &expiresAt, &description, &participantLimit); errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrRecruitmentNotFound
	} else if err != nil {
		return Match{}, err
	}
	if ownerID == userID {
		return Match{}, ErrForbidden
	}
	if !beforeExpiry(expiresAt, now) {
		_, _ = tx.ExecContext(ctx, `UPDATE recruitment_cards SET status='expired',updated_at=$1 WHERE id=$2 AND status IN ('open','matched')`, now.UTC().Format(time.RFC3339Nano), recruitmentID)
		return Match{}, ErrRecruitmentExpired
	}
	if status != "open" && status != "matched" {
		return Match{}, ErrInvalidState
	}
	var acceptedCount int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM matches WHERE card_id=$1 AND status='accepted'`, recruitmentID).Scan(&acceptedCount); err != nil {
		return Match{}, err
	}
	if acceptedCount >= participantLimit {
		return Match{}, ErrInvalidState
	}
	var blocked bool
	if err = tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM blocks b
			WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$2)
			   OR (b.blocker_user_id=$2 AND b.blocked_user_id=$1)
		)`, userID, ownerID).Scan(&blocked); err != nil {
		return Match{}, err
	}
	if blocked {
		return Match{}, ErrBlocked
	}
	var existing Match
	var matchedAt sql.NullString
	if err = tx.QueryRowContext(ctx, `
		SELECT id,status,matched_at,created_at,updated_at FROM matches
		WHERE card_id=$1 AND requester_user_id=$2 FOR UPDATE`, recruitmentID, userID).Scan(
		&existing.ID, &existing.Status, &matchedAt, &existing.CreatedAt, &existing.UpdatedAt); err == nil {
		existing.RecruitmentID = recruitmentID
		if matchedAt.Valid {
			existing.MatchedAt = matchedAt.String
		}
		return existing, ErrDuplicateInterest
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Match{}, err
	}
	id, err := newID()
	if err != nil {
		return Match{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,created_at,updated_at)
		VALUES ($1,$2,$3,$4,'pending',$5,$5)`, id, recruitmentID, userID, ownerID, created); err != nil {
		return Match{}, err
	}
	if s.notifications != nil {
		actorName, nameErr := s.notificationActorNameTx(ctx, tx, userID)
		if nameErr != nil {
			return Match{}, nameErr
		}
		if err = s.notifications.CreateTx(ctx, tx, notification.CreateInput{
			UserID:        ownerID,
			EventKey:      "new_application:" + id,
			Type:          notification.TypeNewApplication,
			TargetID:      id,
			RecruitmentID: recruitmentID,
			Destination:   notification.DestinationApplicants,
			ActorName:     actorName,
			Context:       description,
		}, now); err != nil {
			return Match{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Match{}, err
	}
	return Match{ID: id, RecruitmentID: recruitmentID, Status: "pending", CreatedAt: created, UpdatedAt: created}, nil
}

// WithdrawInterest allows only the requester to cancel a pending application.
// A cancelled application remains in matches so the owner and requester keep
// a consistent history and the unique card/requester relation stays intact.
func (s *Service) WithdrawInterest(ctx context.Context, userID, matchID string, now time.Time) (Match, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(matchID) == "" {
		return Match{}, ErrMatchNotFound
	}
	if err := s.expirePendingMatches(ctx, now); err != nil {
		return Match{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()

	var match Match
	var ownerID, requesterID, description, expiresAt string
	var matchedAt sql.NullString
	if err = tx.QueryRowContext(ctx, `
		SELECT m.id,m.card_id,m.requester_user_id,m.owner_user_id,m.status,
		       m.matched_at,m.created_at,m.updated_at,r.expires_at,r.description
		FROM matches m JOIN recruitment_cards r ON r.id=m.card_id
		WHERE m.id=$1 FOR UPDATE`, matchID).Scan(
		&match.ID, &match.RecruitmentID, &requesterID, &ownerID, &match.Status,
		&matchedAt, &match.CreatedAt, &match.UpdatedAt, &expiresAt, &description); errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrMatchNotFound
	} else if err != nil {
		return Match{}, err
	}
	if matchedAt.Valid {
		match.MatchedAt = matchedAt.String
	}
	if requesterID != userID {
		return Match{}, ErrForbidden
	}
	if match.Status != "pending" {
		return Match{}, ErrInvalidState
	}
	if !beforeExpiry(expiresAt, now) {
		updated := now.UTC().Format(time.RFC3339Nano)
		if _, err = tx.ExecContext(ctx, `UPDATE matches SET status='expired',updated_at=$1 WHERE id=$2 AND status='pending'`, updated, matchID); err != nil {
			return Match{}, err
		}
		if err = tx.Commit(); err != nil {
			return Match{}, err
		}
		return Match{}, ErrRecruitmentExpired
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `
		UPDATE matches SET status='cancelled',updated_at=$1
		WHERE id=$2 AND requester_user_id=$3 AND status='pending'`, updated, matchID, userID); err != nil {
		return Match{}, err
	}
	if s.notifications != nil {
		actorName, nameErr := s.notificationActorNameTx(ctx, tx, requesterID)
		if nameErr != nil {
			return Match{}, nameErr
		}
		if err = s.notifications.CreateTx(ctx, tx, notification.CreateInput{
			UserID:        ownerID,
			EventKey:      "application_withdrawn:" + matchID,
			Type:          notification.TypeApplicationWithdrawn,
			TargetID:      matchID,
			RecruitmentID: match.RecruitmentID,
			Destination:   notification.DestinationApplicants,
			ActorName:     actorName,
			Context:       description,
		}, now); err != nil {
			return Match{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Match{}, err
	}
	match.Status, match.UpdatedAt = "cancelled", updated
	return match, nil
}

func (s *Service) ListMatches(ctx context.Context, userID string, params MatchListParams, now time.Time) ([]MatchView, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrMatchNotFound
	}
	params, err := normalizeMatchListParams(params)
	if err != nil {
		return nil, err
	}
	if err = s.expirePendingMatches(ctx, now); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id,m.card_id,m.requester_user_id,m.owner_user_id,m.status,
		       m.matched_at,m.created_at,m.updated_at,
		       EXISTS(SELECT 1 FROM match_likes ml WHERE ml.match_id=m.id AND ml.liker_user_id=$1)
		FROM matches m
		JOIN users requester ON requester.id=m.requester_user_id AND requester.status='active'
		JOIN users owner ON owner.id=m.owner_user_id AND owner.status='active'
		WHERE ($2 = 'all' AND (m.requester_user_id=$1 OR m.owner_user_id=$1)
		       OR $2 = 'owner' AND m.owner_user_id=$1
		       OR $2 = 'requester' AND m.requester_user_id=$1)
		  AND ($3 = '' OR m.status=$3)
		  AND NOT EXISTS (
				SELECT 1 FROM blocks b
				WHERE (b.blocker_user_id=m.owner_user_id AND b.blocked_user_id=m.requester_user_id)
				   OR (b.blocker_user_id=m.requester_user_id AND b.blocked_user_id=m.owner_user_id)
		  )
		ORDER BY m.updated_at DESC
		LIMIT $4`, userID, params.Role, params.Status, params.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	capacity := params.Limit
	if capacity < 0 {
		capacity = 0
	}
	if capacity > maxSearchLimit {
		capacity = maxSearchLimit
	}
	result := make([]MatchView, 0, capacity)
	for rows.Next() {
		var record matchRecord
		if err = rows.Scan(
			&record.ID, &record.RecruitmentID, &record.RequesterID, &record.OwnerID,
			&record.Status, &record.MatchedAt, &record.CreatedAt, &record.UpdatedAt, &record.LikedByMe,
		); err != nil {
			return nil, err
		}
		view, viewErr := s.buildMatchView(ctx, userID, record)
		if errors.Is(viewErr, ErrMatchNotFound) {
			continue
		}
		if viewErr != nil {
			return nil, viewErr
		}
		result = append(result, view)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) GetMatch(ctx context.Context, userID, matchID string) (MatchView, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(matchID) == "" {
		return MatchView{}, ErrMatchNotFound
	}
	if err := s.expirePendingMatches(ctx, time.Now()); err != nil {
		return MatchView{}, err
	}
	var record matchRecord
	err := s.db.QueryRowContext(ctx, `
		SELECT m.id,m.card_id,m.requester_user_id,m.owner_user_id,m.status,
		       m.matched_at,m.created_at,m.updated_at,
		       EXISTS(SELECT 1 FROM match_likes ml WHERE ml.match_id=m.id AND ml.liker_user_id=$2)
		FROM matches m
		JOIN users requester ON requester.id=m.requester_user_id AND requester.status='active'
		JOIN users owner ON owner.id=m.owner_user_id AND owner.status='active'
		WHERE m.id=$1 AND (m.requester_user_id=$2 OR m.owner_user_id=$2)
		  AND NOT EXISTS (
				SELECT 1 FROM blocks b
				WHERE (b.blocker_user_id=m.owner_user_id AND b.blocked_user_id=m.requester_user_id)
				   OR (b.blocker_user_id=m.requester_user_id AND b.blocked_user_id=m.owner_user_id)
		  )`, matchID, userID).Scan(
		&record.ID, &record.RecruitmentID, &record.RequesterID, &record.OwnerID,
		&record.Status, &record.MatchedAt, &record.CreatedAt, &record.UpdatedAt, &record.LikedByMe)
	if errors.Is(err, sql.ErrNoRows) {
		return MatchView{}, ErrMatchNotFound
	}
	if err != nil {
		return MatchView{}, err
	}
	return s.buildMatchView(ctx, userID, record)
}

func (s *Service) expirePendingMatches(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE matches m SET status='expired',updated_at=$1
		FROM recruitment_cards r
		WHERE r.id=m.card_id AND m.status='pending' AND r.expires_at <= $1`,
		now.UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Service) RejectMatch(ctx context.Context, userID, matchID string, now time.Time) (Match, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()

	var match Match
	var ownerID, requesterID, expiresAt, cardStatus, description string
	var participantLimit int
	var matchedAt sql.NullString
	if err = tx.QueryRowContext(ctx, `
		SELECT m.id,m.card_id,m.owner_user_id,m.requester_user_id,m.status,
		       m.matched_at,m.created_at,m.updated_at,r.expires_at,r.status,r.description,r.participant_limit
		FROM matches m JOIN recruitment_cards r ON r.id=m.card_id
		WHERE m.id=$1 FOR UPDATE`, matchID).Scan(
		&match.ID, &match.RecruitmentID, &ownerID, &requesterID, &match.Status,
		&matchedAt, &match.CreatedAt, &match.UpdatedAt, &expiresAt, &cardStatus, &description, &participantLimit); errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrMatchNotFound
	} else if err != nil {
		return Match{}, err
	}
	if matchedAt.Valid {
		match.MatchedAt = matchedAt.String
	}
	if ownerID != userID {
		return Match{}, ErrForbidden
	}
	if match.Status != "pending" {
		return Match{}, ErrInvalidState
	}
	if !beforeExpiry(expiresAt, now) {
		updated := now.UTC().Format(time.RFC3339Nano)
		if _, err = tx.ExecContext(ctx, `UPDATE matches SET status='expired',updated_at=$1 WHERE id=$2`, updated, matchID); err != nil {
			return Match{}, err
		}
		if err = tx.Commit(); err != nil {
			return Match{}, err
		}
		return Match{}, ErrRecruitmentExpired
	}
	if cardStatus != "open" && cardStatus != "matched" {
		return Match{}, ErrInvalidState
	}
	var acceptedCount int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM matches WHERE card_id=$1 AND status='accepted'`, match.RecruitmentID).Scan(&acceptedCount); err != nil {
		return Match{}, err
	}
	if acceptedCount >= participantLimit {
		return Match{}, ErrInvalidState
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `
		UPDATE matches SET status='rejected',updated_at=$1 WHERE id=$2 AND status='pending'`, updated, matchID); err != nil {
		return Match{}, err
	}
	if s.notifications != nil {
		actorName, nameErr := s.notificationActorNameTx(ctx, tx, ownerID)
		if nameErr != nil {
			return Match{}, nameErr
		}
		if err = s.notifications.CreateTx(ctx, tx, notification.CreateInput{
			UserID:        requesterID,
			EventKey:      "application_rejected:" + matchID,
			Type:          notification.TypeApplicationRejected,
			TargetID:      matchID,
			RecruitmentID: match.RecruitmentID,
			Destination:   notification.DestinationApplicationDetail,
			ActorName:     actorName,
			Context:       description,
		}, now); err != nil {
			return Match{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Match{}, err
	}
	match.Status, match.UpdatedAt = "rejected", updated
	return match, nil
}

func (s *Service) AcceptMatch(ctx context.Context, userID, matchID string, now time.Time) (Match, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()

	// Every acceptance for a recruitment must serialize on the recruitment
	// row, not only on its individual match row. Otherwise two different
	// pending matches can both observe the same accepted count and exceed the
	// participant limit. Lock the card first so this path has the same lock
	// order as SendInterest, then lock the individual match below.
	var recruitmentID string
	if err = tx.QueryRowContext(ctx, `
		SELECT card_id FROM matches WHERE id=$1`, matchID).Scan(&recruitmentID); errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrMatchNotFound
	} else if err != nil {
		return Match{}, err
	}
	if err = tx.QueryRowContext(ctx, `
		SELECT id FROM recruitment_cards WHERE id=$1 FOR UPDATE`, recruitmentID).Scan(&recruitmentID); errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrMatchNotFound
	} else if err != nil {
		return Match{}, err
	}

	var match Match
	var ownerID, requesterID, expiresAt, cardStatus, description string
	var participantLimit int
	var matchedAt sql.NullString
	if err = tx.QueryRowContext(ctx, `
		SELECT m.id,m.card_id,m.owner_user_id,m.requester_user_id,m.status,
		       m.matched_at,m.created_at,m.updated_at,r.expires_at,r.status,r.description,r.participant_limit
		FROM matches m JOIN recruitment_cards r ON r.id=m.card_id
		WHERE m.id=$1 FOR UPDATE OF m`, matchID).Scan(
		&match.ID, &match.RecruitmentID, &ownerID, &requesterID, &match.Status,
		&matchedAt, &match.CreatedAt, &match.UpdatedAt, &expiresAt, &cardStatus, &description, &participantLimit); errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrMatchNotFound
	} else if err != nil {
		return Match{}, err
	}
	if matchedAt.Valid {
		match.MatchedAt = matchedAt.String
	}
	if ownerID != userID {
		return Match{}, ErrForbidden
	}
	if match.Status != "pending" {
		return Match{}, ErrInvalidState
	}
	if !beforeExpiry(expiresAt, now) {
		updated := now.UTC().Format(time.RFC3339Nano)
		if _, err = tx.ExecContext(ctx, `UPDATE matches SET status='expired',updated_at=$1 WHERE id=$2`, updated, matchID); err != nil {
			return Match{}, err
		}
		if err = tx.Commit(); err != nil {
			return Match{}, err
		}
		return Match{}, ErrRecruitmentExpired
	}
	if cardStatus != "open" && cardStatus != "matched" {
		return Match{}, ErrInvalidState
	}
	var acceptedCount int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM matches WHERE card_id=$1 AND status='accepted'`, match.RecruitmentID).Scan(&acceptedCount); err != nil {
		return Match{}, err
	}
	if acceptedCount >= participantLimit {
		return Match{}, ErrInvalidState
	}
	var blocked bool
	if err = tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM blocks b
			WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$2)
			   OR (b.blocker_user_id=$2 AND b.blocked_user_id=$1)
		)`, userID, requesterID).Scan(&blocked); err != nil {
		return Match{}, err
	}
	if blocked {
		return Match{}, ErrBlocked
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `
		UPDATE matches SET status='accepted',matched_at=$1,updated_at=$1 WHERE id=$2`, updated, matchID); err != nil {
		return Match{}, err
	}
	nextCardStatus := "open"
	if acceptedCount+1 >= participantLimit {
		nextCardStatus = "matched"
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE recruitment_cards SET status=$1,updated_at=$2
		WHERE id=$3 AND status IN ('open','matched')`, nextCardStatus, updated, match.RecruitmentID); err != nil {
		return Match{}, err
	}
	if s.notifications != nil {
		actorName, nameErr := s.notificationActorNameTx(ctx, tx, ownerID)
		if nameErr != nil {
			return Match{}, nameErr
		}
		if err = s.notifications.CreateTx(ctx, tx, notification.CreateInput{
			UserID:        requesterID,
			EventKey:      "match_confirmed:" + matchID,
			Type:          notification.TypeMatchConfirmed,
			TargetID:      matchID,
			RecruitmentID: match.RecruitmentID,
			Destination:   notification.DestinationGuideDetail,
			ActorName:     actorName,
			Context:       description,
		}, now); err != nil {
			return Match{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Match{}, err
	}
	match.Status, match.MatchedAt, match.UpdatedAt = "accepted", updated, updated
	return match, nil
}

func (s *Service) CompleteMatch(ctx context.Context, userID, matchID string, now time.Time) (Match, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()
	var match Match
	var requesterID, ownerID string
	var matchedAt sql.NullString
	if err = tx.QueryRowContext(ctx, `
		SELECT id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at
		FROM matches WHERE id=$1 FOR UPDATE`, matchID).Scan(
		&match.ID, &match.RecruitmentID, &requesterID, &ownerID, &match.Status,
		&matchedAt, &match.CreatedAt, &match.UpdatedAt); errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrMatchNotFound
	} else if err != nil {
		return Match{}, err
	}
	if matchedAt.Valid {
		match.MatchedAt = matchedAt.String
	}
	if userID != requesterID && userID != ownerID {
		return Match{}, ErrForbidden
	}
	if match.Status != "accepted" {
		return Match{}, ErrInvalidState
	}
	updated := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `UPDATE matches SET status='completed',updated_at=$1 WHERE id=$2 AND status='accepted'`, updated, matchID); err != nil {
		return Match{}, err
	}
	if err = tx.Commit(); err != nil {
		return Match{}, err
	}
	match.Status, match.UpdatedAt = "completed", updated
	return match, nil
}

// LikeMatch records one appreciation per participant after the scheduled plan
// has ended. A repeated request is idempotent and cannot inflate the count.
func (s *Service) LikeMatch(ctx context.Context, userID, matchID string, now time.Time) (MatchLike, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(matchID) == "" {
		return MatchLike{}, ErrMatchNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MatchLike{}, err
	}
	defer tx.Rollback()

	var requesterID, ownerID, status, availableDate, endTime, timezone string
	err = tx.QueryRowContext(ctx, `
		SELECT m.requester_user_id,m.owner_user_id,m.status,r.available_date,r.end_time,r.timezone
		FROM matches m JOIN recruitment_cards r ON r.id=m.card_id
		WHERE m.id=$1 FOR UPDATE OF m`, matchID).Scan(
		&requesterID, &ownerID, &status, &availableDate, &endTime, &timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return MatchLike{}, ErrMatchNotFound
	}
	if err != nil {
		return MatchLike{}, err
	}
	if userID != requesterID && userID != ownerID {
		return MatchLike{}, ErrForbidden
	}
	if status != "accepted" && status != "completed" {
		return MatchLike{}, ErrInvalidState
	}
	recipientID := otherMatchParticipant(userID, requesterID, ownerID)
	blocked, err := s.blocked(ctx, userID, recipientID)
	if err != nil {
		return MatchLike{}, err
	}
	if blocked {
		return MatchLike{}, ErrBlocked
	}
	if timezone != recruitmentTimezone {
		return MatchLike{}, ErrInvalidState
	}
	scheduledEnd, err := time.ParseInLocation("2006-01-02 15:04", availableDate+" "+endTime, recruitmentLocation)
	if err != nil || now.In(recruitmentLocation).Before(scheduledEnd) {
		return MatchLike{}, ErrInvalidState
	}
	createdAt := now.UTC().Format(time.RFC3339Nano)
	var likedAt string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO match_likes (match_id,liker_user_id,liked_user_id,created_at)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (match_id,liker_user_id) DO NOTHING
		RETURNING created_at`, matchID, userID, recipientID, createdAt).Scan(&likedAt)
	if errors.Is(err, sql.ErrNoRows) {
		if err = tx.QueryRowContext(ctx, `SELECT created_at FROM match_likes WHERE match_id=$1 AND liker_user_id=$2`, matchID, userID).Scan(&likedAt); err != nil {
			return MatchLike{}, err
		}
	} else if err != nil {
		return MatchLike{}, err
	} else if _, err = tx.ExecContext(ctx, `
		UPDATE profiles SET likes_count=likes_count+1,updated_at=$1 WHERE user_id=$2`, createdAt, recipientID); err != nil {
		return MatchLike{}, err
	}
	if err = tx.Commit(); err != nil {
		return MatchLike{}, err
	}
	return MatchLike{MatchID: matchID, Liked: true, LikedAt: likedAt}, nil
}

func (s *Service) UpdateLocation(ctx context.Context, userID string, input LocationInput, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" ||
		!finite(input.Latitude) || input.Latitude < -90 || input.Latitude > 90 ||
		!finite(input.Longitude) || input.Longitude < -180 || input.Longitude > 180 ||
		!finite(input.AccuracyM) || input.AccuracyM < 0 || input.AccuracyM > 100000 {
		return ErrInvalidInput
	}
	capturedAt := now.UTC()
	if strings.TrimSpace(input.CapturedAt) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, input.CapturedAt)
		if err != nil || parsed.After(now.Add(5*time.Minute)) || parsed.Before(now.Add(-24*time.Hour)) {
			return ErrInvalidInput
		}
		capturedAt = parsed.UTC()
	}
	value := capturedAt.Format(time.RFC3339Nano)
	expires := capturedAt.Add(locationTTL).Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO user_locations (user_id,latitude,longitude,accuracy_m,captured_at,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id) DO UPDATE SET
			latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
			accuracy_m=EXCLUDED.accuracy_m,captured_at=EXCLUDED.captured_at,
			expires_at=EXCLUDED.expires_at`, userID, input.Latitude, input.Longitude, input.AccuracyM, value, expires)
	return err
}

func normalizeRecruitmentInput(input RecruitmentInput, now time.Time) (RecruitmentInput, string, error) {
	input.Category = strings.TrimSpace(input.Category)
	if input.Category == "" {
		input.Category = categoryOther
	}
	input.Status = strings.TrimSpace(input.Status)
	if input.Status == "" {
		input.Status = "open"
	}
	if input.Status != "draft" && input.Status != "open" && input.Status != "closed" {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	if !isRecruitmentCategory(input.Category) {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	input.LocationName = strings.TrimSpace(input.LocationName)
	if !utf8.ValidString(input.LocationName) || utf8.RuneCountInString(input.LocationName) > maxLocationNameRunes {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	if input.ParticipantLimit == 0 {
		input.ParticipantLimit = 1
	}
	if input.ParticipantLimit < 1 || input.ParticipantLimit > maxParticipantLimit {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	if input.VisibilityRadiusKM != 1 && input.VisibilityRadiusKM != 3 && input.VisibilityRadiusKM != 5 {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	input.AvailableDate = strings.TrimSpace(input.AvailableDate)
	input.StartTime = strings.TrimSpace(input.StartTime)
	input.EndTime = strings.TrimSpace(input.EndTime)
	input.Timezone = strings.TrimSpace(input.Timezone)
	if input.Timezone == "" {
		input.Timezone = recruitmentTimezone
	}
	if input.Timezone != recruitmentTimezone {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	date, err := time.ParseInLocation("2006-01-02", input.AvailableDate, recruitmentLocation)
	if err != nil {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	startClock, err := time.Parse("15:04", input.StartTime)
	if err != nil {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	endClock, err := time.Parse("15:04", input.EndTime)
	if err != nil || !endClock.After(startClock) {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	input.Keywords, err = normalizeKeywords(input.Keywords)
	if err != nil || len(input.Keywords) == 0 {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	input.Description = strings.TrimSpace(input.Description)
	if input.Description == "" || !utf8.ValidString(input.Description) || utf8.RuneCountInString(input.Description) > maxDescriptionRunes {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	if (input.Latitude == nil) != (input.Longitude == nil) {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	if input.Latitude != nil && (!finite(*input.Latitude) || !finite(*input.Longitude) || *input.Latitude < -90 || *input.Latitude > 90 || *input.Longitude < -180 || *input.Longitude > 180) {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	if input.LocationAccuracyM != nil && (!finite(*input.LocationAccuracyM) || *input.LocationAccuracyM < 0 || *input.LocationAccuracyM > 100000) {
		return RecruitmentInput{}, "", ErrInvalidInput
	}
	input.AvailableDate = date.Format("2006-01-02")
	input.StartTime = startClock.Format("15:04")
	input.EndTime = endClock.Format("15:04")
	// Keep the database value as a canonical absolute instant. Applications
	// close 24 hours before the JST wall-clock start time.
	expires := time.Date(date.Year(), date.Month(), date.Day(), startClock.Hour(), startClock.Minute(), 0, 0, recruitmentLocation).
		Add(-recruitmentLeadTime).
		UTC()
	if input.Status == "open" && !expires.After(now.In(recruitmentLocation)) {
		return RecruitmentInput{}, "", ErrRecruitmentExpired
	}
	return input, expires.Format(time.RFC3339Nano), nil
}

func normalizeKeywords(values []string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxKeywordRunes {
			return nil, ErrInvalidInput
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
		if len(result) > maxKeywords {
			return nil, ErrInvalidInput
		}
	}
	return result, nil
}

func normalizeSearchParams(params SearchParams) (SearchParams, error) {
	params.Category = strings.TrimSpace(params.Category)
	if params.Category != "" && !isRecruitmentCategory(params.Category) {
		return SearchParams{}, ErrInvalidInput
	}
	if params.RadiusKM != 0 && params.RadiusKM != 1 && params.RadiusKM != 3 && params.RadiusKM != 5 {
		return SearchParams{}, ErrInvalidInput
	}
	if (params.Latitude == nil) != (params.Longitude == nil) {
		return SearchParams{}, ErrInvalidInput
	}
	if params.Latitude != nil && (!finite(*params.Latitude) || !finite(*params.Longitude) || *params.Latitude < -90 || *params.Latitude > 90 || *params.Longitude < -180 || *params.Longitude > 180) {
		return SearchParams{}, ErrInvalidInput
	}
	if params.AvailableDate != "" {
		if _, err := time.Parse("2006-01-02", params.AvailableDate); err != nil {
			return SearchParams{}, ErrInvalidInput
		}
	}
	if params.AvailableFrom != "" || params.AvailableTo != "" {
		from, fromErr := time.Parse("2006-01-02", params.AvailableFrom)
		to, toErr := time.Parse("2006-01-02", params.AvailableTo)
		if fromErr != nil || toErr != nil || to.Before(from) || to.After(from.AddDate(0, maxSearchRangeMonths, 0)) {
			return SearchParams{}, ErrInvalidInput
		}
	}
	if (params.StartTime == "") != (params.EndTime == "") {
		return SearchParams{}, ErrInvalidInput
	}
	if params.StartTime != "" {
		start, err := time.Parse("15:04", params.StartTime)
		end, endErr := time.Parse("15:04", params.EndTime)
		if err != nil || endErr != nil || !end.After(start) {
			return SearchParams{}, ErrInvalidInput
		}
	}
	keywords, err := normalizeKeywords(params.Keywords)
	if err != nil {
		return SearchParams{}, err
	}
	params.Keywords = keywords
	if params.Limit < 0 {
		return SearchParams{}, ErrInvalidInput
	}
	if params.Limit == 0 {
		params.Limit = defaultSearchLimit
	}
	if params.Limit > maxSearchLimit {
		params.Limit = maxSearchLimit
	}
	return params, nil
}

func isRecruitmentCategory(value string) bool {
	switch value {
	case categoryFood, categoryPlaces, categoryActivity, categoryOther:
		return true
	default:
		return false
	}
}

func normalizeMatchListParams(params MatchListParams) (MatchListParams, error) {
	params.Role = strings.TrimSpace(params.Role)
	if params.Role == "" {
		params.Role = "all"
	}
	if params.Role != "all" && params.Role != "owner" && params.Role != "requester" {
		return MatchListParams{}, ErrInvalidInput
	}
	params.Status = strings.TrimSpace(params.Status)
	if params.Status != "" && params.Status != "pending" && params.Status != "accepted" &&
		params.Status != "rejected" && params.Status != "cancelled" && params.Status != "blocked" && params.Status != "expired" &&
		params.Status != "completed" {
		return MatchListParams{}, ErrInvalidInput
	}
	if params.Limit < 0 {
		return MatchListParams{}, ErrInvalidInput
	}
	if params.Limit == 0 {
		params.Limit = defaultSearchLimit
	}
	if params.Limit > maxSearchLimit {
		params.Limit = maxSearchLimit
	}
	return params, nil
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func (s *Service) profileComplete(ctx context.Context, userID string) (bool, error) {
	var complete bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM profiles
			WHERE user_id=$1 AND btrim(name) <> '' AND nationality_code ~ '^[A-Z]{2}$'
		)`, userID).Scan(&complete)
	return complete, err
}

func (s *Service) notificationActorNameTx(ctx context.Context, tx *sql.Tx, userID string) (string, error) {
	var name string
	err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(p.name,''),u.display_name,'')
		FROM users u LEFT JOIN profiles p ON p.user_id=u.id
		WHERE u.id=$1 AND u.status='active'`, userID).Scan(&name)
	return strings.TrimSpace(name), err
}

func (s *Service) loadCard(ctx context.Context, recruitmentID string) (cardRecord, error) {
	var record cardRecord
	err := s.db.QueryRowContext(ctx, `
		SELECT r.id, r.owner_user_id, r.category, COALESCE(p.name,''),
		       COALESCE(p.nationality_code,''), r.available_date, r.start_time,
		       r.end_time, r.timezone, r.keywords_json, r.description,
		       r.location_name, r.participant_limit, r.visibility_radius_km, r.latitude, r.longitude,
		       r.location_accuracy_m, r.status, r.expires_at, r.created_at,
		       r.updated_at, COALESCE(p.identity_status,'unverified')
		FROM recruitment_cards r
		JOIN users u ON u.id=r.owner_user_id
		LEFT JOIN profiles p ON p.user_id=r.owner_user_id
		WHERE r.id=$1 AND u.status='active'`, recruitmentID).Scan(
		&record.ID, &record.OwnerUserID, &record.Category, &record.AuthorName,
		&record.NationalityCode, &record.AvailableDate, &record.StartTime,
		&record.EndTime, &record.Timezone, &record.KeywordsJSON, &record.Description,
		&record.LocationName, &record.ParticipantLimit,
		&record.VisibilityRadiusKM, &record.Latitude, &record.Longitude,
		&record.LocationAccuracyM, &record.Status, &record.ExpiresAt, &record.CreatedAt,
		&record.UpdatedAt, &record.IdentityStatus)
	return record, err
}

func (s *Service) buildMatchView(ctx context.Context, userID string, record matchRecord) (MatchView, error) {
	if userID != record.RequesterID && userID != record.OwnerID {
		return MatchView{}, ErrMatchNotFound
	}
	card, err := s.loadCard(ctx, record.RecruitmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return MatchView{}, ErrMatchNotFound
	}
	if err != nil {
		return MatchView{}, err
	}
	keywords, err := decodeKeywords(card.KeywordsJSON)
	if err != nil {
		return MatchView{}, err
	}
	otherID := record.OwnerID
	if userID == record.OwnerID {
		otherID = record.RequesterID
	}
	other, err := s.loadPublicProfile(ctx, otherID)
	if errors.Is(err, sql.ErrNoRows) {
		return MatchView{}, ErrMatchNotFound
	}
	if err != nil {
		return MatchView{}, err
	}
	match := Match{
		ID:            record.ID,
		RecruitmentID: record.RecruitmentID,
		Status:        record.Status,
		CreatedAt:     record.CreatedAt,
		UpdatedAt:     record.UpdatedAt,
	}
	if record.MatchedAt.Valid {
		match.MatchedAt = record.MatchedAt.String
	}
	return MatchView{
		Match:       match,
		OtherUser:   other,
		Recruitment: buildRecruitment(card, keywords, ""),
		LikedByMe:   record.LikedByMe,
	}, nil
}

func otherMatchParticipant(userID, requesterID, ownerID string) string {
	if userID == requesterID {
		return ownerID
	}
	return requesterID
}

func (s *Service) loadPublicProfile(ctx context.Context, userID string) (PublicProfile, error) {
	var profile PublicProfile
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id,COALESCE(NULLIF(p.name,''),u.display_name,''),
		       COALESCE(p.nationality_code,''),COALESCE(p.bio,''),
		       COALESCE(p.identity_status,'unverified'),COALESCE(p.likes_count,0)
		FROM users u LEFT JOIN profiles p ON p.user_id=u.id
		WHERE u.id=$1 AND u.status='active'`, userID).Scan(
		&profile.ID, &profile.Name, &profile.NationalityCode, &profile.Bio,
		&profile.IdentityStatus, &profile.LikesCount)
	return profile, err
}

func (s *Service) blocked(ctx context.Context, first, second string) (bool, error) {
	var blocked bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM blocks b
			WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$2)
			   OR (b.blocker_user_id=$2 AND b.blocked_user_id=$1)
		)`, first, second).Scan(&blocked)
	return blocked, err
}

func (s *Service) currentLocation(ctx context.Context, userID string, now time.Time) (*float64, *float64) {
	var latitude, longitude float64
	err := s.db.QueryRowContext(ctx, `
		SELECT latitude,longitude FROM user_locations
		WHERE user_id=$1 AND expires_at>$2`, userID, now.UTC().Format(time.RFC3339Nano)).Scan(&latitude, &longitude)
	if err != nil {
		return nil, nil
	}
	return &latitude, &longitude
}

func buildRecruitment(record cardRecord, keywords []string, band string) Recruitment {
	return Recruitment{
		ID: record.ID, Category: record.Category, AuthorName: record.AuthorName,
		NationalityCode: record.NationalityCode, Rating: 0, AvailableDate: record.AvailableDate,
		StartTime: record.StartTime, EndTime: record.EndTime, Timezone: record.Timezone,
		DurationHours: durationHours(record.StartTime, record.EndTime), Keywords: keywords,
		Description: record.Description, LocationName: record.LocationName,
		ParticipantLimit: record.ParticipantLimit, VisibilityRadiusKM: record.VisibilityRadiusKM,
		DistanceBand: band, Status: record.Status, ExpiresAt: record.ExpiresAt,
		CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt,
	}
}

func decodeKeywords(value string) ([]string, error) {
	var keywords []string
	if err := json.Unmarshal([]byte(value), &keywords); err != nil {
		return nil, err
	}
	return normalizeKeywords(keywords)
}

func matchesKeywords(values, requested []string) bool {
	if len(requested) == 0 {
		return true
	}
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[strings.ToLower(value)] = struct{}{}
	}
	for _, requestedValue := range requested {
		requestedValue = strings.ToLower(requestedValue)
		if _, ok := set[requestedValue]; ok {
			continue
		}
		foundPartial := false
		for value := range set {
			if strings.Contains(value, requestedValue) {
				foundPartial = true
				break
			}
		}
		if !foundPartial {
			return false
		}
	}
	return true
}

func matchesDateAndTime(record cardRecord, params SearchParams) bool {
	if params.AvailableDate != "" && record.AvailableDate != params.AvailableDate {
		return false
	}
	if params.AvailableFrom != "" && record.AvailableDate < params.AvailableFrom {
		return false
	}
	if params.AvailableTo != "" && record.AvailableDate > params.AvailableTo {
		return false
	}
	if params.StartTime == "" {
		return true
	}
	start, _ := time.Parse("15:04", record.StartTime)
	end, _ := time.Parse("15:04", record.EndTime)
	requestedStart, _ := time.Parse("15:04", params.StartTime)
	requestedEnd, _ := time.Parse("15:04", params.EndTime)
	return start.Before(requestedEnd) && requestedStart.Before(end)
}

func distanceFor(record cardRecord, latitude, longitude *float64) (float64, bool) {
	if latitude == nil || longitude == nil || !record.Latitude.Valid || !record.Longitude.Valid {
		return 0, false
	}
	return haversineKM(*latitude, *longitude, record.Latitude.Float64, record.Longitude.Float64), true
}

func haversineKM(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	const earthRadiusKM = 6371.0088
	latitude1, longitude1, latitude2, longitude2 = latitude1*math.Pi/180, longitude1*math.Pi/180, latitude2*math.Pi/180, longitude2*math.Pi/180
	dLatitude, dLongitude := latitude2-latitude1, longitude2-longitude1
	a := math.Sin(dLatitude/2)*math.Sin(dLatitude/2) + math.Cos(latitude1)*math.Cos(latitude2)*math.Sin(dLongitude/2)*math.Sin(dLongitude/2)
	if a > 1 {
		a = 1
	}
	return earthRadiusKM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func distanceBand(distance float64, available bool) string {
	if !available {
		return ""
	}
	if distance <= 1 {
		return "within_1_km"
	}
	if distance <= 3 {
		return "within_3_km"
	}
	return "within_5_km"
}

func durationHours(startValue, endValue string) float64 {
	start, startErr := time.Parse("15:04", startValue)
	end, endErr := time.Parse("15:04", endValue)
	if startErr != nil || endErr != nil || !end.After(start) {
		return 0
	}
	return end.Sub(start).Hours()
}

func beforeExpiry(value string, now time.Time) bool {
	expires, err := time.Parse(time.RFC3339Nano, value)
	return err == nil && now.In(recruitmentLocation).Before(expires.In(recruitmentLocation))
}

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableValue(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	result := value.Float64
	return &result
}

func applyPatch(input *RecruitmentInput, patch RecruitmentPatch) {
	if patch.Category != nil {
		input.Category = *patch.Category
	}
	if patch.AvailableDate != nil {
		input.AvailableDate = *patch.AvailableDate
	}
	if patch.StartTime != nil {
		input.StartTime = *patch.StartTime
	}
	if patch.EndTime != nil {
		input.EndTime = *patch.EndTime
	}
	if patch.Timezone != nil {
		input.Timezone = *patch.Timezone
	}
	if patch.Keywords != nil {
		input.Keywords = *patch.Keywords
	}
	if patch.Description != nil {
		input.Description = *patch.Description
	}
	if patch.LocationName != nil {
		input.LocationName = *patch.LocationName
	}
	if patch.ParticipantLimit != nil {
		input.ParticipantLimit = *patch.ParticipantLimit
	}
	if patch.VisibilityRadiusKM != nil {
		input.VisibilityRadiusKM = *patch.VisibilityRadiusKM
	}
	if patch.Latitude != nil || patch.Longitude != nil {
		input.Latitude, input.Longitude = patch.Latitude, patch.Longitude
	}
	if patch.LocationAccuracyM != nil {
		input.LocationAccuracyM = patch.LocationAccuracyM
	}
	if patch.Status != nil {
		input.Status = *patch.Status
	}
}

func changesRecruitmentContent(patch RecruitmentPatch) bool {
	return patch.Category != nil || patch.AvailableDate != nil || patch.StartTime != nil ||
		patch.EndTime != nil || patch.Timezone != nil || patch.Keywords != nil ||
		patch.Description != nil || patch.LocationName != nil || patch.ParticipantLimit != nil ||
		patch.VisibilityRadiusKM != nil || patch.Latitude != nil ||
		patch.Longitude != nil || patch.LocationAccuracyM != nil || patch.ClearLocation
}

func newID() (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

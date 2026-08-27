package user

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrUserNotFound   = errors.New("user not found")
	ErrInvalidProfile = errors.New("invalid profile")
)

const (
	maxProfileNameRunes = 64
	maxProfileBioRunes  = 1000
)

var countryCodePattern = regexp.MustCompile(`^[A-Z]{2}$`)

// Service owns the authenticated user's public profile data. Server-managed
// fields such as identity status and likes are intentionally not writable.
type Service struct {
	db *sql.DB
}

type Profile struct {
	UserID          string `json:"user_id"`
	Name            string `json:"name"`
	NationalityCode string `json:"nationality_code"`
	Bio             string `json:"bio"`
	IconPhotoID     string `json:"icon_photo_id,omitempty"`
	IdentityStatus  string `json:"identity_status"`
	LikesCount      int    `json:"likes_count"`
	Completed       bool   `json:"completed"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

type ProfilePatch struct {
	Name            *string `json:"name"`
	NationalityCode *string `json:"nationality_code"`
	Bio             *string `json:"bio"`
}

func NewService(database *sql.DB) *Service {
	return &Service{db: database}
}

func (s *Service) Get(ctx context.Context, userID string) (Profile, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return Profile{}, ErrUserNotFound
	}
	var profile Profile
	var status string
	if err := s.db.QueryRowContext(ctx, `
		SELECT u.status,
		       COALESCE(NULLIF(p.name, ''), u.display_name, ''),
		       COALESCE(p.nationality_code, ''),
		       COALESCE(p.bio, ''),
		       COALESCE(p.icon_photo_id, ''),
		       COALESCE(p.identity_status, 'unverified'),
		       COALESCE(p.likes_count, 0),
		       COALESCE(p.updated_at, '')
		FROM users u
		LEFT JOIN profiles p ON p.user_id = u.id
		WHERE u.id = $1`, userID).Scan(
		&status,
		&profile.Name,
		&profile.NationalityCode,
		&profile.Bio,
		&profile.IconPhotoID,
		&profile.IdentityStatus,
		&profile.LikesCount,
		&profile.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Profile{}, ErrUserNotFound
		}
		return Profile{}, err
	}
	if status != "active" {
		return Profile{}, ErrUserNotFound
	}
	profile.UserID = userID
	profile.Completed = strings.TrimSpace(profile.Name) != "" && profile.NationalityCode != ""
	return profile, nil
}

func (s *Service) Patch(ctx context.Context, userID string, patch ProfilePatch, now time.Time) (Profile, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return Profile{}, ErrUserNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, err
	}
	defer tx.Rollback()

	var status, name, nationalityCode, bio string
	if err = tx.QueryRowContext(ctx, `
		SELECT u.status,
		       COALESCE(NULLIF(p.name, ''), u.display_name, ''),
		       COALESCE(p.nationality_code, ''),
		       COALESCE(p.bio, '')
		FROM users u
		LEFT JOIN profiles p ON p.user_id = u.id
		WHERE u.id = $1
		FOR UPDATE OF u`, userID).Scan(&status, &name, &nationalityCode, &bio); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Profile{}, ErrUserNotFound
		}
		return Profile{}, err
	}
	if status != "active" {
		return Profile{}, ErrUserNotFound
	}
	if patch.Name != nil {
		name = *patch.Name
	}
	if patch.NationalityCode != nil {
		nationalityCode = *patch.NationalityCode
	}
	if patch.Bio != nil {
		bio = *patch.Bio
	}
	name, nationalityCode, bio, err = normalizeProfileInput(name, nationalityCode, bio)
	if err != nil {
		return Profile{}, err
	}
	updatedAt := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO profiles (user_id, name, nationality_code, bio, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $5)
		ON CONFLICT (user_id) DO UPDATE SET
			name = EXCLUDED.name,
			nationality_code = EXCLUDED.nationality_code,
			bio = EXCLUDED.bio,
			updated_at = EXCLUDED.updated_at`,
		userID, name, nationalityCode, bio, updatedAt); err != nil {
		return Profile{}, err
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE users SET display_name=$1, updated_at=$2 WHERE id=$3`, name, updatedAt, userID); err != nil {
		return Profile{}, err
	}
	if err = tx.Commit(); err != nil {
		return Profile{}, err
	}
	return s.Get(ctx, userID)
}

func normalizeProfileInput(name, nationalityCode, bio string) (string, string, string, error) {
	name = strings.TrimSpace(name)
	nationalityCode = strings.TrimSpace(nationalityCode)
	bio = strings.TrimSpace(bio)
	if len(nationalityCode) != 2 || !asciiLettersOnly(nationalityCode) {
		return "", "", "", ErrInvalidProfile
	}
	nationalityCode = strings.ToUpper(nationalityCode)
	if !validText(name, maxProfileNameRunes, true, false) ||
		!countryCodePattern.MatchString(nationalityCode) ||
		!validText(bio, maxProfileBioRunes, false, true) {
		return "", "", "", ErrInvalidProfile
	}
	return name, nationalityCode, bio, nil
}

func asciiLettersOnly(value string) bool {
	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') {
			return false
		}
	}
	return true
}

func validText(value string, maxRunes int, required, allowLineBreaks bool) bool {
	if !utf8.ValidString(value) || (required && value == "") || utf8.RuneCountInString(value) > maxRunes {
		return false
	}
	for _, r := range value {
		if !unicode.IsControl(r) {
			continue
		}
		if allowLineBreaks && (r == '\n' || r == '\r' || r == '\t') {
			continue
		}
		return false
	}
	return true
}

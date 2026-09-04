package memorymonster

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
	ErrNotFound      = errors.New("memory monster not found")
	ErrForbidden     = errors.New("memory monster forbidden")
	ErrInvalidInput  = errors.New("invalid memory monster input")
	ErrInvalidState  = errors.New("invalid memory monster state")
	ErrPhotoNotFound = errors.New("memory monster source photo not found")
)

const (
	MaxGeneratePhotoBytes = 10 * 1024 * 1024
	MaxGeneratedBytes     = 12 * 1024 * 1024
	MaxObjectRunes        = 15
	MaxMemoryRunes        = 100
)

type Monster struct {
	ID                     string `json:"id"`
	MatchID                string `json:"match_id"`
	MeetingID              string `json:"meeting_id,omitempty"`
	GuideDate              string `json:"guide_date,omitempty"`
	LocationName           string `json:"location_name,omitempty"`
	SourcePhotoID          string `json:"source_photo_id"`
	SourcePhotoContentType string `json:"source_photo_content_type,omitempty"`
	MemorableObject        string `json:"memorable_object"`
	MemoryText             string `json:"memory_text"`
	PromptVersion          string `json:"prompt_version"`
	Provider               string `json:"provider"`
	GeneratedContentType   string `json:"generated_content_type"`
	CreatedAt              string `json:"created_at"`
}

type CreateInput struct {
	MatchID          string
	MeetingID        string
	SourcePhotoID    string
	Photo            []byte
	PhotoContentType string
	MemorableObject  string
	MemoryText       string
}

type Image struct {
	Bytes       []byte
	ContentType string
}

type Service struct {
	db        *sql.DB
	store     *Store
	generator Generator
}

func NewService(database *sql.DB, store *Store, generator Generator) *Service {
	if generator == nil {
		generator = PlaceholderGenerator{}
	}
	return &Service{db: database, store: store, generator: generator}
}

func (s *Service) Create(ctx context.Context, userID string, input CreateInput, now time.Time) (Monster, error) {
	if s == nil || s.db == nil || s.store == nil {
		return Monster{}, ErrNotFound
	}
	input.MatchID = strings.TrimSpace(input.MatchID)
	input.MeetingID = strings.TrimSpace(input.MeetingID)
	input.SourcePhotoID = strings.TrimSpace(input.SourcePhotoID)
	input.PhotoContentType = strings.TrimSpace(input.PhotoContentType)
	input.MemorableObject = normalizeText(input.MemorableObject)
	input.MemoryText = normalizeText(input.MemoryText)
	if err := validateCreateInput(userID, input); err != nil {
		return Monster{}, err
	}
	if err := s.authorizeCreate(ctx, userID, input.MatchID, input.MeetingID, input.SourcePhotoID); err != nil {
		return Monster{}, err
	}
	generated, err := s.generator.Generate(ctx, GenerateInput{
		UserID:           userID,
		Photo:            input.Photo,
		PhotoContentType: input.PhotoContentType,
		MemorableObject:  input.MemorableObject,
		MemoryText:       input.MemoryText,
	})
	if err != nil {
		return Monster{}, err
	}
	if !validGeneratedContentType(generated.ContentType) || len(generated.Bytes) == 0 || len(generated.Bytes) > MaxGeneratedBytes {
		return Monster{}, ErrGenerationFailed
	}
	id, err := randomID()
	if err != nil {
		return Monster{}, err
	}
	storagePath, err := s.store.Save(userID, id, generated.ContentType, generated.Bytes)
	if err != nil {
		return Monster{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	monster := Monster{
		ID:                   id,
		MatchID:              input.MatchID,
		MeetingID:            input.MeetingID,
		SourcePhotoID:        input.SourcePhotoID,
		MemorableObject:      input.MemorableObject,
		MemoryText:           input.MemoryText,
		PromptVersion:        PromptVersion,
		Provider:             generated.Provider,
		GeneratedContentType: generated.ContentType,
		CreatedAt:            created,
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO memory_monsters (id,owner_user_id,match_id,meeting_id,source_photo_id,memorable_object,memory_text,prompt_version,provider,generated_storage_path,generated_content_type,created_at)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12)`,
		monster.ID, userID, monster.MatchID, monster.MeetingID, monster.SourcePhotoID, monster.MemorableObject, monster.MemoryText,
		monster.PromptVersion, monster.Provider, storagePath, monster.GeneratedContentType, monster.CreatedAt,
	)
	if err != nil {
		_ = s.store.Delete(storagePath)
		return Monster{}, err
	}
	return monster, nil
}

func (s *Service) List(ctx context.Context, userID string, limit int) ([]Monster, error) {
	if s == nil || s.db == nil {
		return nil, ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT mm.id,mm.match_id,COALESCE(mm.meeting_id,''),COALESCE(rc.available_date,''),COALESCE(rc.location_name,''),mm.source_photo_id,
		       COALESCE(p.content_type,''),mm.memorable_object,mm.memory_text,mm.prompt_version,mm.provider,mm.generated_content_type,mm.created_at
		FROM memory_monsters mm
		JOIN matches m ON m.id=mm.match_id
		JOIN recruitment_cards rc ON rc.id=m.card_id
		LEFT JOIN photos p ON p.id=mm.source_photo_id AND p.owner_user_id=mm.owner_user_id AND p.deleted_at IS NULL
		WHERE mm.owner_user_id=$1 AND mm.deleted_at IS NULL
		ORDER BY mm.created_at DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Monster, 0)
	for rows.Next() {
		var item Monster
		if err := rows.Scan(&item.ID, &item.MatchID, &item.MeetingID, &item.GuideDate, &item.LocationName, &item.SourcePhotoID, &item.SourcePhotoContentType, &item.MemorableObject, &item.MemoryText, &item.PromptVersion, &item.Provider, &item.GeneratedContentType, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) GetImage(ctx context.Context, userID, monsterID string) (Image, error) {
	if s == nil || s.db == nil || s.store == nil {
		return Image{}, ErrNotFound
	}
	var storagePath, contentType string
	err := s.db.QueryRowContext(ctx, `
		SELECT generated_storage_path,generated_content_type
		FROM memory_monsters
		WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, strings.TrimSpace(monsterID), userID).Scan(&storagePath, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return Image{}, ErrNotFound
	}
	if err != nil {
		return Image{}, err
	}
	body, err := s.store.Read(storagePath, MaxGeneratedBytes)
	if err != nil {
		return Image{}, err
	}
	return Image{Bytes: body, ContentType: contentType}, nil
}

func (s *Service) authorizeCreate(ctx context.Context, userID, matchID, meetingID, sourcePhotoID string) error {
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM matches
			WHERE id=$1 AND status IN ('accepted','completed') AND (owner_user_id=$2 OR requester_user_id=$2)
		)`, matchID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrForbidden
	}
	if meetingID != "" {
		err = s.db.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM meeting_sessions ms
				JOIN matches m ON m.id=ms.match_id
				WHERE ms.id=$1 AND ms.match_id=$2 AND ms.status='completed' AND (m.owner_user_id=$3 OR m.requester_user_id=$3)
			)`, meetingID, matchID, userID).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return ErrInvalidState
		}
	}
	err = s.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM photos
			WHERE id=$1 AND owner_user_id=$2 AND visibility='private' AND deleted_at IS NULL
		)`, sourcePhotoID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrPhotoNotFound
	}
	return nil
}

func validateCreateInput(userID string, input CreateInput) error {
	if strings.TrimSpace(userID) == "" || input.MatchID == "" || input.SourcePhotoID == "" {
		return ErrInvalidInput
	}
	if len(input.Photo) < 16 || len(input.Photo) > MaxGeneratePhotoBytes || !validSourcePhotoContentType(input.PhotoContentType) {
		return ErrInvalidInput
	}
	if utf8.RuneCountInString(input.MemorableObject) < 1 || utf8.RuneCountInString(input.MemorableObject) > MaxObjectRunes {
		return ErrInvalidInput
	}
	if utf8.RuneCountInString(input.MemoryText) < 1 || utf8.RuneCountInString(input.MemoryText) > MaxMemoryRunes {
		return ErrInvalidInput
	}
	return nil
}

func normalizeText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func validSourcePhotoContentType(value string) bool {
	switch value {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func validGeneratedContentType(value string) bool {
	switch value {
	case "image/png", "image/jpeg", "image/webp":
		return true
	default:
		return false
	}
}

func randomID() (string, error) {
	var b [18]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

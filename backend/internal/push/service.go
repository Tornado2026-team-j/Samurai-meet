package push

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrInvalidSettings = errors.New("invalid push settings")

type Service struct{ db *sql.DB }

type Settings struct {
	Token           string `json:"token"`
	Platform        string `json:"platform"`
	Enabled         bool   `json:"enabled"`
	ChatEnabled     bool   `json:"chat_enabled"`
	MatchEnabled    bool   `json:"match_enabled"`
	ReminderEnabled bool   `json:"reminder_enabled"`
}

func NewService(db *sql.DB) *Service { return &Service{db: db} }

func (s *Service) Upsert(ctx context.Context, userID string, input Settings, now time.Time) (Settings, error) {
	input.Token = strings.TrimSpace(input.Token)
	input.Platform = strings.TrimSpace(input.Platform)
	if s == nil || s.db == nil || userID == "" || !utf8.ValidString(input.Token) || len(input.Token) < 10 || len(input.Token) > 512 ||
		(input.Platform != "ios" && input.Platform != "android") {
		return Settings{}, ErrInvalidSettings
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO push_devices (token,user_id,platform,enabled,chat_enabled,match_enabled,reminder_enabled,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
		ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id,platform=EXCLUDED.platform,
			enabled=EXCLUDED.enabled,chat_enabled=EXCLUDED.chat_enabled,match_enabled=EXCLUDED.match_enabled,
			reminder_enabled=EXCLUDED.reminder_enabled,updated_at=EXCLUDED.updated_at`,
		input.Token, userID, input.Platform, input.Enabled, input.ChatEnabled, input.MatchEnabled, input.ReminderEnabled, stamp)
	return input, err
}

func (s *Service) Latest(ctx context.Context, userID string) (Settings, error) {
	var result Settings
	err := s.db.QueryRowContext(ctx, `
		SELECT token,platform,enabled,chat_enabled,match_enabled,reminder_enabled
		FROM push_devices WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`, userID).Scan(
		&result.Token, &result.Platform, &result.Enabled, &result.ChatEnabled, &result.MatchEnabled, &result.ReminderEnabled)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{Enabled: true, ChatEnabled: true, MatchEnabled: true, ReminderEnabled: true}, nil
	}
	return result, err
}

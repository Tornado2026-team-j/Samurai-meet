// Command devchatseed provisions an accepted match + chat thread and two live
// sessions against the local development database, so the chat feature can be
// exercised end to end without the Google OAuth / passkey / matching flow.
//
// Dev-only. It refuses to run unless APP_ENV is a development value.
//
//	cd backend
//	go run ./cmd/devchatseed
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/db"
)

func main() {
	cfg := config.Load()
	if env := strings.ToLower(strings.TrimSpace(cfg.Environment)); env == "production" || env == "prod" {
		log.Fatalf("devchatseed refuses to run with APP_ENV=%q", cfg.Environment)
	}
	if cfg.JWS.SigningKey == "" {
		log.Fatal("JWS_SIGNING_KEY must be set (backend/.env) so sessions can be signed")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	database, err := db.Open(ctx, cfg.Database)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer database.Close()

	signer, err := auth.NewRotatingSigner(
		cfg.JWS.KeyID,
		map[string]string{cfg.JWS.KeyID: cfg.JWS.SigningKey},
		cfg.JWS.Issuer,
		cfg.JWS.Audience,
	)
	if err != nil {
		log.Fatalf("signer init failed: %v", err)
	}

	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	suffix := now.Format("20060102-150405")

	ownerID := "devseed-owner-" + suffix
	requesterID := "devseed-requester-" + suffix
	cardID := "devseed-card-" + suffix
	matchID := "devseed-match-" + suffix

	for _, u := range []struct{ id, name string }{
		{ownerID, "Dev Owner"},
		{requesterID, "Dev Requester"},
	} {
		if _, err := database.ExecContext(ctx, `
			INSERT INTO users (id, google_subject_id, display_name, status, created_at, updated_at)
			VALUES ($1, $2, $3, 'active', $4, $4)`,
			u.id, "devseed-"+u.id, u.name, stamp); err != nil {
			log.Fatalf("insert user %s: %v", u.id, err)
		}
	}

	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards
			(id, owner_user_id, category, available_date, start_time, end_time, timezone,
			 visibility_radius_km, status, expires_at, created_at, updated_at)
		VALUES ($1, $2, 'Food', $3, '18:00', '20:00', 'Asia/Tokyo', 3, 'matched', $4, $5, $5)`,
		cardID, ownerID, now.Format("2006-01-02"), now.Add(24*time.Hour).Format(time.RFC3339Nano), stamp); err != nil {
		log.Fatalf("insert recruitment_card: %v", err)
	}

	if _, err := database.ExecContext(ctx, `
		INSERT INTO matches
			(id, card_id, requester_user_id, owner_user_id, status, matched_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'accepted', $5, $5, $5)`,
		matchID, cardID, requesterID, ownerID, stamp); err != nil {
		log.Fatalf("insert match: %v", err)
	}

	sessions := auth.NewSessionService(database, signer)
	chatSvc := chat.NewService(database, signer)

	ownerTokens, err := sessions.CreateSession(ctx, ownerID, now)
	if err != nil {
		log.Fatalf("create owner session: %v", err)
	}
	requesterTokens, err := sessions.CreateSession(ctx, requesterID, now)
	if err != nil {
		log.Fatalf("create requester session: %v", err)
	}

	summaries, err := chatSvc.List(ctx, ownerID, now)
	if err != nil || len(summaries) != 1 {
		log.Fatalf("chat List() = %v, %v (want exactly one chat)", summaries, err)
	}
	chatID := summaries[0].ID

	out := map[string]any{
		"api_base_url": os.Getenv("SEED_API_BASE_URL"),
		"chat_id":      chatID,
		"match_id":     matchID,
		"owner": map[string]string{
			"user_id":       ownerTokens.UserID,
			"session_id":    ownerTokens.SessionID,
			"access_token":  ownerTokens.AccessToken,
			"refresh_token": ownerTokens.RefreshToken,
		},
		"requester": map[string]string{
			"user_id":       requesterTokens.UserID,
			"session_id":    requesterTokens.SessionID,
			"access_token":  requesterTokens.AccessToken,
			"refresh_token": requesterTokens.RefreshToken,
		},
	}
	encoded, _ := json.MarshalIndent(out, "", "  ")
	fmt.Println(string(encoded))
}

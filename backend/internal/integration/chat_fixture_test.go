package integration

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

// chatFixture is transport-neutral test data for accepted-chat behavior.
// Realtime transport integration now belongs to WebTransport-specific tests;
// these helpers intentionally do not start or reference a WebSocket server.
type chatFixture struct {
	database         *sql.DB
	signer           *auth.Signer
	sessions         *auth.SessionService
	chatService      *chat.Service
	ownerID          string
	requesterID      string
	ownerSession     auth.SessionTokens
	requesterSession auth.SessionTokens
	chatID           string
}

func seedAcceptedChat(t *testing.T, ctx context.Context, now time.Time) *chatFixture {
	t.Helper()
	database := openIsolatedDatabase(t)
	stamp := now.Format(time.RFC3339Nano)
	f := &chatFixture{database: database, ownerID: randomID(t), requesterID: randomID(t)}
	for _, u := range []struct{ id, google string }{{f.ownerID, "chat-owner-" + f.ownerID}, {f.requesterID, "chat-requester-" + f.requesterID}} {
		if _, err := database.ExecContext(ctx, `INSERT INTO users (id,google_subject_id,display_name,status,created_at,updated_at) VALUES ($1,$2,$3,'active',$4,$4)`, u.id, u.google, "User "+u.id[:6], stamp); err != nil {
			t.Fatal(err)
		}
	}
	cardID := randomID(t)
	if _, err := database.ExecContext(ctx, `INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,visibility_radius_km,status,expires_at,created_at,updated_at) VALUES ($1,$2,'Food','2026-08-27','18:00','20:00','Asia/Tokyo',3,'matched',$3,$4,$4)`, cardID, f.ownerID, now.Add(24*time.Hour).Format(time.RFC3339Nano), stamp); err != nil {
		t.Fatal(err)
	}
	matchID := randomID(t)
	if _, err := database.ExecContext(ctx, `INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at) VALUES ($1,$2,$3,$4,'accepted',$5,$5,$5)`, matchID, cardID, f.requesterID, f.ownerID, stamp); err != nil {
		t.Fatal(err)
	}
	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x53}, 32)), "chat-fixture-issuer", "chat-fixture-audience")
	if err != nil {
		t.Fatal(err)
	}
	f.signer = signer
	f.sessions = auth.NewSessionService(database, signer)
	f.chatService = chat.NewService(database, signer)
	if f.ownerSession, err = f.sessions.CreateSession(ctx, f.ownerID, now); err != nil {
		t.Fatal(err)
	}
	if f.requesterSession, err = f.sessions.CreateSession(ctx, f.requesterID, now); err != nil {
		t.Fatal(err)
	}
	summaries, err := f.chatService.List(ctx, f.ownerID, now)
	if err != nil || len(summaries) != 1 {
		t.Fatalf("List() = %v, %v", summaries, err)
	}
	f.chatID = summaries[0].ID
	return f
}

var chatCiphertext = base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 48))
var chatNonce = base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{9}, 12))

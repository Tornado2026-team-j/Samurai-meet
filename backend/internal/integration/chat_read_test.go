package integration

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

// TestChatMarkReadSequenceContract locks the read-marker contract: the client
// passes the highest sequence it has seen, the server clamps it to the newest
// live message in the chat, and the stored marker only moves forward.
func TestChatMarkReadSequenceContract(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Now().UTC()

	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x62}, 32)), "chat-read-issuer", "chat-read-audience")
	if err != nil {
		t.Fatal(err)
	}
	chatService := chat.NewService(database, signer)

	ownerID, requesterID, populatedChatID := seedAcceptedChat(t, database, now)
	emptyOwnerID, _, emptyChatID := seedAcceptedChat(t, database, now)

	send := func(clientMessageID string) int64 {
		t.Helper()
		message, _, err := chatService.SendMessage(ctx, requesterID, populatedChatID, chat.SendMessageInput{
			ClientMessageID: clientMessageID,
			Ciphertext:      base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 48)),
			Nonce:           base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{9}, 12)),
			Algorithm:       "AES-256-GCM",
			KeyVersion:      "v1",
		}, now)
		if err != nil {
			t.Fatalf("SendMessage(%s) error = %v", clientMessageID, err)
		}
		return message.Sequence
	}

	first := send("cmid-1")
	latest := send("cmid-2")

	readMarker := func(chatID, userID string) int64 {
		t.Helper()
		var stored int64
		if err := database.QueryRowContext(ctx,
			`SELECT last_read_sequence FROM chat_read_states WHERE chat_id=$1 AND user_id=$2`,
			chatID, userID).Scan(&stored); err != nil {
			t.Fatalf("read marker lookup error = %v", err)
		}
		return stored
	}

	// A sequence beyond the newest message clamps down to that message.
	if err := chatService.MarkRead(ctx, ownerID, populatedChatID, latest+1000, now); err != nil {
		t.Fatalf("MarkRead(beyond latest) error = %v", err)
	}
	if got := readMarker(populatedChatID, ownerID); got != latest {
		t.Fatalf("stored marker = %d, want clamped to %d", got, latest)
	}

	// A lower sequence never moves the marker backward.
	if err := chatService.MarkRead(ctx, ownerID, populatedChatID, first, now); err != nil {
		t.Fatalf("MarkRead(older) error = %v", err)
	}
	if got := readMarker(populatedChatID, ownerID); got != latest {
		t.Fatalf("stored marker = %d, want still %d", got, latest)
	}

	// Non-positive sequences are invalid input.
	if err := chatService.MarkRead(ctx, ownerID, populatedChatID, 0, now); !errors.Is(err, chat.ErrChatInvalidInput) {
		t.Fatalf("MarkRead(0) error = %v, want ErrChatInvalidInput", err)
	}

	// A chat with no messages has nothing to mark read.
	if err := chatService.MarkRead(ctx, emptyOwnerID, emptyChatID, 5, now); !errors.Is(err, chat.ErrMessageNotFound) {
		t.Fatalf("MarkRead(empty chat) error = %v, want ErrMessageNotFound", err)
	}
}

// seedAcceptedChat inserts two users, a matched card, an accepted match, and
// lazily creates the chat thread. It returns owner id, requester id, chat id.
func seedAcceptedChat(t *testing.T, database *sql.DB, now time.Time) (string, string, string) {
	t.Helper()
	ctx := context.Background()
	stamp := now.Format(time.RFC3339Nano)

	ownerID := randomID(t)
	requesterID := randomID(t)
	for _, u := range []struct{ id, google string }{
		{ownerID, "read-owner-" + ownerID},
		{requesterID, "read-requester-" + requesterID},
	} {
		if _, err := database.ExecContext(ctx, `
			INSERT INTO users (id,google_subject_id,display_name,status,created_at,updated_at)
			VALUES ($1,$2,$3,'active',$4,$4)`, u.id, u.google, "User "+u.id[:6], stamp); err != nil {
			t.Fatal(err)
		}
	}

	cardID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,visibility_radius_km,status,expires_at,created_at,updated_at)
		VALUES ($1,$2,'Food','2026-08-27','18:00','20:00','Asia/Tokyo',3,'matched',$3,$4,$4)`,
		cardID, ownerID, now.Add(24*time.Hour).Format(time.RFC3339Nano), stamp); err != nil {
		t.Fatal(err)
	}
	matchID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at)
		VALUES ($1,$2,$3,$4,'accepted',$5,$5,$5)`, matchID, cardID, requesterID, ownerID, stamp); err != nil {
		t.Fatal(err)
	}

	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x63}, 32)), "seed-issuer", "seed-audience")
	if err != nil {
		t.Fatal(err)
	}
	summaries, err := chat.NewService(database, signer).List(ctx, ownerID, now)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("chat summaries = %d, want 1", len(summaries))
	}
	return ownerID, requesterID, summaries[0].ID
}

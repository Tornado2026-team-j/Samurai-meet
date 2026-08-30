package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

// TestChatMarkReadSequenceContract locks the read-marker contract: the client
// passes the highest sequence it has seen, the server clamps it to the newest
// live message in the chat, and the stored marker only moves forward.
func TestChatMarkReadSequenceContract(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()

	populated := seedAcceptedChat(t, ctx, now)
	empty := seedAcceptedChat(t, ctx, now)

	send := func(clientMessageID string) int64 {
		t.Helper()
		message, _, err := populated.chatService.SendMessage(ctx, populated.requesterID, populated.chatID, chat.SendMessageInput{
			ClientMessageID: clientMessageID,
			Ciphertext:      chatCiphertext,
			Nonce:           chatNonce,
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

	readMarker := func(f *chatFixture, userID string) int64 {
		t.Helper()
		var stored int64
		if err := f.database.QueryRowContext(ctx,
			`SELECT last_read_sequence FROM chat_read_states WHERE chat_id=$1 AND user_id=$2`,
			f.chatID, userID).Scan(&stored); err != nil {
			t.Fatalf("read marker lookup error = %v", err)
		}
		return stored
	}

	// A sequence beyond the newest message clamps down to that message.
	if err := populated.chatService.MarkRead(ctx, populated.ownerID, populated.chatID, latest+1000, now); err != nil {
		t.Fatalf("MarkRead(beyond latest) error = %v", err)
	}
	if got := readMarker(populated, populated.ownerID); got != latest {
		t.Fatalf("stored marker = %d, want clamped to %d", got, latest)
	}

	// A lower sequence never moves the marker backward.
	if err := populated.chatService.MarkRead(ctx, populated.ownerID, populated.chatID, first, now); err != nil {
		t.Fatalf("MarkRead(older) error = %v", err)
	}
	if got := readMarker(populated, populated.ownerID); got != latest {
		t.Fatalf("stored marker = %d, want still %d", got, latest)
	}

	// Non-positive sequences are invalid input.
	if err := populated.chatService.MarkRead(ctx, populated.ownerID, populated.chatID, 0, now); !errors.Is(err, chat.ErrChatInvalidInput) {
		t.Fatalf("MarkRead(0) error = %v, want ErrChatInvalidInput", err)
	}

	// A chat with no messages has nothing to mark read.
	if err := empty.chatService.MarkRead(ctx, empty.ownerID, empty.chatID, 5, now); !errors.Is(err, chat.ErrMessageNotFound) {
		t.Fatalf("MarkRead(empty chat) error = %v, want ErrMessageNotFound", err)
	}
}

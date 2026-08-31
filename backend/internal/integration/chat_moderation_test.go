package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/safety"
)

// TestChatModerationEscalatesToReportsQueue covers the AI content-check plumbing:
// a participant can resolve a message for screening, an outsider cannot, and a
// flagged verdict lands in the reports queue as an ai_auto operator-review item
// (idempotent per reporter+message).
func TestChatModerationEscalatesToReportsQueue(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()

	f := seedAcceptedChat(t, ctx, now)
	message, _, err := f.chatService.SendMessage(ctx, f.requesterID, f.chatID, chat.SendMessageInput{
		ClientMessageID: "cmid-mod-1",
		Ciphertext:      chatCiphertext,
		Nonce:           chatNonce,
		Algorithm:       "AES-256-GCM",
		KeyVersion:      "v1",
	}, now)
	if err != nil {
		t.Fatalf("SendMessage() error = %v", err)
	}

	target, err := f.chatService.ResolveModerationTarget(ctx, f.ownerID, f.chatID, message.ID)
	if err != nil {
		t.Fatalf("ResolveModerationTarget() error = %v", err)
	}
	if target.MessageSenderID != f.requesterID || target.OtherUserID != f.requesterID || target.MessageID != message.ID {
		t.Fatalf("ResolveModerationTarget() = %#v", target)
	}

	outsider := randomID(t)
	if _, err := f.chatService.ResolveModerationTarget(ctx, outsider, f.chatID, message.ID); !errors.Is(err, chat.ErrChatForbidden) {
		t.Fatalf("outsider resolve error = %v, want ErrChatForbidden", err)
	}
	if _, err := f.chatService.ResolveModerationTarget(ctx, f.ownerID, f.chatID, randomID(t)); !errors.Is(err, chat.ErrMessageNotFound) {
		t.Fatalf("unknown message resolve error = %v, want ErrMessageNotFound", err)
	}

	safetyService := safety.NewService(f.database)
	report, err := safetyService.RecordModerationFlag(ctx, f.ownerID, message.ID, []string{"external_contact", "personal_info"}, "block", now)
	if err != nil {
		t.Fatalf("RecordModerationFlag() error = %v", err)
	}
	if report.Source != "ai_auto" || report.TargetType != "message" || report.TargetID != message.ID || report.Status != "received" {
		t.Fatalf("moderation report = %#v", report)
	}

	repeat, err := safetyService.RecordModerationFlag(ctx, f.ownerID, message.ID, []string{"external_contact"}, "block", now.Add(time.Minute))
	if err != nil || repeat.ID != report.ID {
		t.Fatalf("repeat flag = %#v err=%v, want same report %s", repeat, err, report.ID)
	}

	var source, comment string
	if err := f.database.QueryRowContext(ctx,
		`SELECT source, comment FROM reports WHERE id=$1`, report.ID).Scan(&source, &comment); err != nil {
		t.Fatalf("reports row lookup error = %v", err)
	}
	if source != "ai_auto" || comment == "" {
		t.Fatalf("stored report source=%q comment=%q", source, comment)
	}
}

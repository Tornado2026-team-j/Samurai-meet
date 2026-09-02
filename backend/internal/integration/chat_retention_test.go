package integration

import (
	"context"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

func TestChatMessageRetentionPurge(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	f.chatService.ConfigureMessageRetention(30)

	send := func(id string) chat.Message {
		msg, _, err := f.chatService.SendMessage(ctx, f.requesterID, f.chatID, chat.SendMessageInput{
			ClientMessageID: id, Ciphertext: chatCiphertext, Nonce: chatNonce,
			Algorithm: "AES-256-GCM", KeyVersion: "v1",
		}, now)
		if err != nil {
			t.Fatalf("send %s: %v", id, err)
		}
		return msg
	}

	old1 := send("old-1")
	old2 := send("old-2")
	recent := send("recent-1")
	for index, message := range []chat.Message{old1, old2} {
		if err := f.chatService.SaveMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, chat.EncryptedMessageTranslation{
			TargetLanguage:  "ja",
			Ciphertext:      base64Value(byte(0x41+index), 32),
			Nonce:           base64Value(byte(0x51+index), 12),
			Algorithm:       "AES-256-GCM",
			KeyVersion:      "chat-translation-keyb-v1",
			MessageRevision: message.CreatedAt,
		}, now); err != nil {
			t.Fatalf("SaveMessageTranslation %s: %v", message.ID, err)
		}
	}

	stale := now.Add(-45 * 24 * time.Hour).Format(time.RFC3339Nano)
	for _, m := range []chat.Message{old1, old2} {
		if _, err := f.database.ExecContext(ctx, `UPDATE messages SET created_at=$1 WHERE id=$2`, stale, m.ID); err != nil {
			t.Fatalf("backdate %s: %v", m.ID, err)
		}
	}

	purged, err := f.chatService.PurgeExpiredMessages(ctx, now)
	if err != nil {
		t.Fatalf("PurgeExpiredMessages: %v", err)
	}
	if purged != 2 {
		t.Fatalf("purged = %d, want 2", purged)
	}

	// The tombstoned rows lost their ciphertext and nonce and gained deleted_at.
	for _, m := range []chat.Message{old1, old2} {
		var ciphertext, nonce, deletedAt string
		if err := f.database.QueryRowContext(ctx, `SELECT ciphertext,nonce,COALESCE(deleted_at,'') FROM messages WHERE id=$1`, m.ID).Scan(&ciphertext, &nonce, &deletedAt); err != nil {
			t.Fatalf("read tombstone %s: %v", m.ID, err)
		}
		if ciphertext != "" || nonce != "" || deletedAt == "" {
			t.Fatalf("message %s not fully tombstoned: ciphertext=%q nonce=%q deleted_at=%q", m.ID, ciphertext, nonce, deletedAt)
		}
	}
	var translationCount int
	if err := f.database.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_message_translations WHERE message_id IN ($1,$2)`, old1.ID, old2.ID).Scan(&translationCount); err != nil {
		t.Fatalf("read purged translation cache: %v", err)
	}
	if translationCount != 0 {
		t.Fatalf("translation cache survived retention purge: %d rows", translationCount)
	}

	// The recent message is untouched.
	var recentCiphertext string
	if err := f.database.QueryRowContext(ctx, `SELECT ciphertext FROM messages WHERE id=$1`, recent.ID).Scan(&recentCiphertext); err != nil {
		t.Fatal(err)
	}
	if recentCiphertext != chatCiphertext {
		t.Fatalf("recent message was altered: %q", recentCiphertext)
	}

	// One audit row per purged message, tagged with the active window.
	var auditCount, auditDays int
	if err := f.database.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(MAX(retention_days),0) FROM chat_message_deletions WHERE reason='retention' AND chat_id=$1`, f.chatID).Scan(&auditCount, &auditDays); err != nil {
		t.Fatal(err)
	}
	if auditCount != 2 || auditDays != 30 {
		t.Fatalf("audit rows = %d (retention_days %d), want 2 (30)", auditCount, auditDays)
	}

	// History no longer returns the tombstoned messages.
	page, err := f.chatService.ListMessages(ctx, f.requesterID, f.chatID, 0, 50, now)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ClientMessageID != "recent-1" {
		t.Fatalf("history after purge = %+v", page.Items)
	}

	// Re-running is a no-op.
	if again, err := f.chatService.PurgeExpiredMessages(ctx, now); err != nil || again != 0 {
		t.Fatalf("second purge = %d, %v (want 0, nil)", again, err)
	}
}

package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

func TestChatMessageEditAndDelete(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)

	message, _, err := f.chatService.SendMessage(ctx, f.requesterID, f.chatID, chat.SendMessageInput{
		ClientMessageID: "mutation-1",
		Ciphertext:      chatCiphertext,
		Nonce:           chatNonce,
		Algorithm:       "AES-256-GCM",
		KeyVersion:      "chat-keyb-v1",
	}, now)
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	initialTranslation := chat.EncryptedMessageTranslation{
		TargetLanguage:  "ja",
		Ciphertext:      base64Value(0x31, 32),
		Nonce:           base64Value(0x32, 12),
		Algorithm:       "AES-256-GCM",
		KeyVersion:      "chat-translation-dek-v1",
		MessageRevision: message.CreatedAt,
	}
	if err := f.chatService.SaveMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, initialTranslation, now); err != nil {
		t.Fatalf("SaveMessageTranslation: %v", err)
	}
	if _, err := f.chatService.AuthorizeMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, "legacy plaintext", ""); err != chat.ErrTranslationBindingMissing {
		t.Fatalf("legacy message translation authorization error = %v, want %v", err, chat.ErrTranslationBindingMissing)
	}
	cached, found, revision, err := f.chatService.LookupMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, "ja")
	if err != nil || !found || revision != message.CreatedAt || cached.Ciphertext != initialTranslation.Ciphertext {
		t.Fatalf("LookupMessageTranslation = %+v, found=%v, revision=%q, err=%v", cached, found, revision, err)
	}
	history, err := f.chatService.ListMessages(ctx, f.requesterID, f.chatID, 0, 50, now)
	if err != nil || len(history.Items) != 1 || len(history.Items[0].Translations) != 1 {
		t.Fatalf("encrypted translation was not returned with message history: items=%d translations=%d err=%v", len(history.Items), func() int {
			if len(history.Items) == 0 {
				return 0
			}
			return len(history.Items[0].Translations)
		}(), err)
	}

	updated, err := f.chatService.UpdateMessage(ctx, f.requesterID, f.chatID, message.ID, chat.UpdateMessageInput{
		Ciphertext:              base64Value(0x21, 48),
		Nonce:                   base64Value(0x22, 12),
		Algorithm:               "AES-256-GCM",
		KeyVersion:              "chat-dek-v1",
		PlaintextCommitment:     testPlaintextCommitment("Updated", base64Value(0x23, 16), testTranslationCommitmentKey()),
		PlaintextCommitmentSalt: base64Value(0x23, 16),
	}, now.Add(time.Second))
	if err != nil {
		t.Fatalf("UpdateMessage: %v", err)
	}
	if updated.ID != message.ID || updated.Sequence != message.Sequence || updated.ClientMessageID != message.ClientMessageID || updated.EditedAt == "" {
		t.Fatalf("updated identity = %+v, want stable id/sequence/client id and edited_at", updated)
	}
	if updated.Ciphertext == message.Ciphertext || updated.Nonce == message.Nonce {
		t.Fatalf("updated ciphertext metadata was not replaced: before=%+v after=%+v", message, updated)
	}
	if _, found, revision, err := f.chatService.LookupMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, "ja"); err != nil || found || revision != updated.EditedAt {
		t.Fatalf("translation after edit = found=%v revision=%q err=%v, want cache invalidated at new revision", found, revision, err)
	}
	if revision, err := f.chatService.AuthorizeMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, "Updated", testTranslationCommitmentKey()); err != nil || revision != updated.EditedAt {
		t.Fatalf("translation binding for updated text = revision=%q err=%v", revision, err)
	}
	if _, err := f.chatService.AuthorizeMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, "arbitrary text", testTranslationCommitmentKey()); err != chat.ErrTranslationBindingMismatch {
		t.Fatalf("arbitrary translation text error = %v, want %v", err, chat.ErrTranslationBindingMismatch)
	}
	updatedTranslation := initialTranslation
	updatedTranslation.Ciphertext = base64Value(0x33, 32)
	updatedTranslation.MessageRevision = updated.EditedAt
	if err := f.chatService.SaveMessageTranslation(ctx, f.requesterID, f.chatID, message.ID, updatedTranslation, now.Add(2*time.Second)); err != nil {
		t.Fatalf("SaveMessageTranslation after edit: %v", err)
	}

	if _, err := f.chatService.UpdateMessage(ctx, f.ownerID, f.chatID, message.ID, chat.UpdateMessageInput{
		Ciphertext: chatCiphertext,
		Nonce:      chatNonce,
		Algorithm:  "AES-256-GCM",
		KeyVersion: "chat-keyb-v1",
	}, now.Add(2*time.Second)); err != chat.ErrChatForbidden {
		t.Fatalf("cross-user edit error = %v, want %v", err, chat.ErrChatForbidden)
	}

	if err := f.chatService.DeleteMessage(ctx, f.ownerID, f.chatID, message.ID, now.Add(3*time.Second)); err != chat.ErrChatForbidden {
		t.Fatalf("cross-user delete error = %v, want %v", err, chat.ErrChatForbidden)
	}
	if err := f.chatService.DeleteMessage(ctx, f.requesterID, f.chatID, message.ID, now.Add(3*time.Second)); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}

	var ciphertext, nonce, deletedAt string
	if err := f.database.QueryRowContext(ctx, `SELECT ciphertext,nonce,COALESCE(deleted_at,'') FROM messages WHERE id=$1`, message.ID).Scan(&ciphertext, &nonce, &deletedAt); err != nil {
		t.Fatalf("read deleted message: %v", err)
	}
	if ciphertext != "" || nonce != "" || deletedAt == "" {
		t.Fatalf("deleted message was not tombstoned: ciphertext=%q nonce=%q deleted_at=%q", ciphertext, nonce, deletedAt)
	}

	var reason string
	if err := f.database.QueryRowContext(ctx, `SELECT reason FROM chat_message_deletions WHERE message_id=$1`, message.ID).Scan(&reason); err != nil {
		t.Fatalf("read deletion audit: %v", err)
	}
	if reason != "user_request" {
		t.Fatalf("deletion reason = %q, want user_request", reason)
	}
	var translationCount int
	if err := f.database.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_message_translations WHERE message_id=$1`, message.ID).Scan(&translationCount); err != nil {
		t.Fatalf("read deleted translation cache: %v", err)
	}
	if translationCount != 0 {
		t.Fatalf("encrypted translation cache survived deletion: %d rows", translationCount)
	}

	page, err := f.chatService.ListMessages(ctx, f.requesterID, f.chatID, 0, 50, now)
	if err != nil {
		t.Fatalf("ListMessages after delete: %v", err)
	}
	if len(page.Items) != 0 {
		t.Fatalf("deleted message remains in history: %+v", page.Items)
	}
	if err := f.chatService.DeleteMessage(ctx, f.requesterID, f.chatID, message.ID, now.Add(4*time.Second)); err != chat.ErrMessageNotFound {
		t.Fatalf("repeated delete error = %v, want %v", err, chat.ErrMessageNotFound)
	}
}

func TestChatTranslationRebindsLegacyPublicCommitment(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	text := "legacy text"
	salt := base64Value(0x51, 16)
	legacyCommitment := legacyTestPlaintextCommitment(text, salt)
	message, _, err := f.chatService.SendMessage(ctx, f.ownerID, f.chatID, chat.SendMessageInput{
		ClientMessageID:         "legacy-binding-1",
		Ciphertext:              chatCiphertext,
		Nonce:                   chatNonce,
		Algorithm:               "AES-256-GCM",
		KeyVersion:              "chat-dek-v1",
		PlaintextCommitment:     legacyCommitment,
		PlaintextCommitmentSalt: salt,
	}, now)
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if _, err := f.chatService.AuthorizeMessageTranslation(ctx, f.ownerID, f.chatID, message.ID, text, testTranslationCommitmentKey()); err != nil {
		t.Fatalf("AuthorizeMessageTranslation legacy binding: %v", err)
	}
	var stored string
	if err := f.database.QueryRowContext(ctx, `SELECT plaintext_commitment FROM messages WHERE id=$1`, message.ID).Scan(&stored); err != nil {
		t.Fatalf("read rebound commitment: %v", err)
	}
	if stored == legacyCommitment || stored != testPlaintextCommitment(text, salt, testTranslationCommitmentKey()) {
		t.Fatalf("stored commitment = %q, want keyed commitment distinct from legacy value", stored)
	}
}

func base64Value(value byte, length int) string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{value}, length))
}

func testTranslationCommitmentKey() string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x44}, sha256.Size))
}

func testPlaintextCommitment(text, salt, commitmentKey string) string {
	key, err := base64.RawURLEncoding.DecodeString(commitmentKey)
	if err != nil {
		panic(err)
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("samurai-meet:chat-message-plaintext-commitment/v2\n" + strings.TrimSpace(salt) + "\n" + strings.TrimSpace(text)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func legacyTestPlaintextCommitment(text, salt string) string {
	digest := sha256.Sum256([]byte("samurai-meet:chat-message-plaintext-commitment/v1\n" + strings.TrimSpace(salt) + "\n" + strings.TrimSpace(text)))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

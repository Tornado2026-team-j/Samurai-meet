package integration

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

func TestChatTranslationRateLimitIsAccountScopedAndSharedInFlight(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	messages := seedTranslationMessages(t, f, ctx, now, 3)
	f.chatService.ConfigureTranslationRateLimit(2, 0.001, 1)

	firstRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[0].ID, messages[0].CreatedAt, "ja", now)
	if err != nil {
		t.Fatalf("first translation reservation: %v", err)
	}
	second, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[1].ID, messages[1].CreatedAt, "ja", now)
	if !errors.Is(err, chat.ErrTranslationRateLimited) || second != nil {
		t.Fatalf("in-flight reservation returned a release=%t err=%v, want account in-flight limit", second != nil, err)
	}
	firstRelease()

	secondRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[1].ID, messages[1].CreatedAt, "ja", now)
	if err != nil {
		t.Fatalf("second translation reservation after release: %v", err)
	}
	secondRelease()

	third, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[2].ID, messages[2].CreatedAt, "ja", now)
	if !errors.Is(err, chat.ErrTranslationRateLimited) || third != nil {
		t.Fatalf("account token reservation returned a release=%t err=%v, want exhausted account quota", third != nil, err)
	}

	otherAccountRelease, err := f.chatService.BeginMessageTranslation(ctx, f.requesterID, f.chatID, messages[0].ID, messages[0].CreatedAt, "ja", now)
	if err != nil {
		t.Fatalf("other account translation reservation: %v", err)
	}
	otherAccountRelease()
}

func TestChatTranslationRateLimitSuppressesDuplicateInFlightRequest(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	messages := seedTranslationMessages(t, f, ctx, now, 2)
	f.chatService.ConfigureTranslationRateLimit(2, 0.001, 2)

	firstRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[0].ID, messages[0].CreatedAt, "ja", now)
	if err != nil {
		t.Fatalf("first translation reservation: %v", err)
	}
	duplicate, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[0].ID, messages[0].CreatedAt, "ja", now)
	if !errors.Is(err, chat.ErrTranslationRateLimited) || duplicate != nil {
		t.Fatalf("duplicate reservation returned a release=%t err=%v, want suppressed duplicate", duplicate != nil, err)
	}
	firstRelease()

	nextRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[1].ID, messages[1].CreatedAt, "ja", now)
	if err != nil {
		t.Fatalf("new request after duplicate suppression: %v", err)
	}
	nextRelease()
}

func TestChatTranslationReservationRejectsStaleRevision(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	messages := seedTranslationMessages(t, f, ctx, now, 1)
	message := messages[0]
	if _, err := f.chatService.UpdateMessage(ctx, f.ownerID, f.chatID, message.ID, chat.UpdateMessageInput{
		Ciphertext: chatCiphertext,
		Nonce:      chatNonce,
		Algorithm:  "AES-256-GCM",
		KeyVersion: "chat-keyb-v1",
	}, now.Add(time.Second)); err != nil {
		t.Fatalf("UpdateMessage: %v", err)
	}

	release, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, message.ID, message.CreatedAt, "ja", now.Add(2*time.Second))
	if !errors.Is(err, chat.ErrMessageTranslationStale) || release != nil {
		t.Fatalf("stale translation reservation returned release=%t err=%v, want stale rejection", release != nil, err)
	}
}

func seedTranslationMessages(t *testing.T, f *chatFixture, ctx context.Context, now time.Time, count int) []chat.Message {
	t.Helper()
	messages := make([]chat.Message, 0, count)
	for index := 0; index < count; index++ {
		message, _, err := f.chatService.SendMessage(ctx, f.ownerID, f.chatID, chat.SendMessageInput{
			ClientMessageID: fmt.Sprintf("translation-%d", index),
			Ciphertext:      chatCiphertext,
			Nonce:           chatNonce,
			Algorithm:       "AES-256-GCM",
			KeyVersion:      "chat-keyb-v1",
		}, now)
		if err != nil {
			t.Fatalf("SendMessage(%d): %v", index, err)
		}
		messages = append(messages, message)
	}
	return messages
}

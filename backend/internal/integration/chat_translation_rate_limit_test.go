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

	firstRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[0].ID, messages[0].CreatedAt, translationTestText(0), testTranslationCommitmentKey(), "ja", now)
	if err != nil {
		t.Fatalf("first translation reservation: %v", err)
	}
	second, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[1].ID, messages[1].CreatedAt, translationTestText(1), testTranslationCommitmentKey(), "ja", now)
	if !errors.Is(err, chat.ErrTranslationRateLimited) || second != nil {
		t.Fatalf("in-flight reservation returned a release=%t err=%v, want account in-flight limit", second != nil, err)
	}
	firstRelease()

	secondRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[1].ID, messages[1].CreatedAt, translationTestText(1), testTranslationCommitmentKey(), "ja", now)
	if err != nil {
		t.Fatalf("second translation reservation after release: %v", err)
	}
	secondRelease()

	third, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[2].ID, messages[2].CreatedAt, translationTestText(2), testTranslationCommitmentKey(), "ja", now)
	if !errors.Is(err, chat.ErrTranslationRateLimited) || third != nil {
		t.Fatalf("account token reservation returned a release=%t err=%v, want exhausted account quota", third != nil, err)
	}

	otherAccountRelease, err := f.chatService.BeginMessageTranslation(ctx, f.requesterID, f.chatID, messages[0].ID, messages[0].CreatedAt, translationTestText(0), testTranslationCommitmentKey(), "ja", now)
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

	firstRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[0].ID, messages[0].CreatedAt, translationTestText(0), testTranslationCommitmentKey(), "ja", now)
	if err != nil {
		t.Fatalf("first translation reservation: %v", err)
	}
	duplicate, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[0].ID, messages[0].CreatedAt, translationTestText(0), testTranslationCommitmentKey(), "ja", now)
	if !errors.Is(err, chat.ErrTranslationRateLimited) || duplicate != nil {
		t.Fatalf("duplicate reservation returned a release=%t err=%v, want suppressed duplicate", duplicate != nil, err)
	}
	firstRelease()

	nextRelease, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[1].ID, messages[1].CreatedAt, translationTestText(1), testTranslationCommitmentKey(), "ja", now)
	if err != nil {
		t.Fatalf("new request after duplicate suppression: %v", err)
	}
	nextRelease()
}

func TestChatTranslationRateLimitDoesNotDoubleRefillAfterClockRollback(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	messages := seedTranslationMessages(t, f, ctx, now, 4)
	f.chatService.ConfigureTranslationRateLimit(2, 1, 4)

	reserve := func(index int, at time.Time) func() {
		t.Helper()
		release, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[index].ID, messages[index].CreatedAt, translationTestText(index), testTranslationCommitmentKey(), "ja", at)
		if err != nil {
			t.Fatalf("translation reservation %d at %s: %v", index, at.Format(time.RFC3339Nano), err)
		}
		return release
	}

	reserve(0, now)()
	// A forward clock movement must still refill the account bucket.
	reserve(1, now.Add(10*time.Second))()
	// Consume the remaining token while the wall clock is behind the watermark.
	reserve(2, now.Add(5*time.Second))()

	last, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, messages[3].ID, messages[3].CreatedAt, translationTestText(3), testTranslationCommitmentKey(), "ja", now.Add(10*time.Second))
	if !errors.Is(err, chat.ErrTranslationRateLimited) || last != nil {
		t.Fatalf("translation reservation after clock rollback returned release=%t err=%v, want no double refill", last != nil, err)
	}
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

	release, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, message.ID, message.CreatedAt, translationTestText(0), testTranslationCommitmentKey(), "ja", now.Add(2*time.Second))
	if !errors.Is(err, chat.ErrMessageTranslationStale) || release != nil {
		t.Fatalf("stale translation reservation returned release=%t err=%v, want stale rejection", release != nil, err)
	}
}

func TestChatTranslationReservationSerializesMessageEdit(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	messages := seedTranslationMessages(t, f, ctx, now, 1)
	message := messages[0]
	release, err := f.chatService.BeginMessageTranslation(ctx, f.ownerID, f.chatID, message.ID, message.CreatedAt, translationTestText(0), testTranslationCommitmentKey(), "ja", now)
	if err != nil {
		t.Fatalf("translation reservation: %v", err)
	}

	updateDone := make(chan error, 1)
	go func() {
		_, updateErr := f.chatService.UpdateMessage(ctx, f.ownerID, f.chatID, message.ID, chat.UpdateMessageInput{
			Ciphertext:              base64Value(0x41, 48),
			Nonce:                   base64Value(0x42, 12),
			Algorithm:               "AES-256-GCM",
			KeyVersion:              "chat-dek-v1",
			PlaintextCommitment:     testPlaintextCommitment("edited", base64Value(0x43, 16), testTranslationCommitmentKey()),
			PlaintextCommitmentSalt: base64Value(0x43, 16),
		}, now.Add(time.Second))
		updateDone <- updateErr
	}()

	select {
	case updateErr := <-updateDone:
		t.Fatalf("message edit completed while translation provider lease was active: %v", updateErr)
	case <-time.After(250 * time.Millisecond):
	}
	release()
	select {
	case updateErr := <-updateDone:
		if updateErr != nil {
			t.Fatalf("message edit after translation lease release: %v", updateErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("message edit remained blocked after translation lease release")
	}
}

func seedTranslationMessages(t *testing.T, f *chatFixture, ctx context.Context, now time.Time, count int) []chat.Message {
	t.Helper()
	messages := make([]chat.Message, 0, count)
	for index := 0; index < count; index++ {
		text := translationTestText(index)
		salt := base64Value(byte(0x30+index), 16)
		message, _, err := f.chatService.SendMessage(ctx, f.ownerID, f.chatID, chat.SendMessageInput{
			ClientMessageID:         fmt.Sprintf("translation-%d", index),
			Ciphertext:              chatCiphertext,
			Nonce:                   chatNonce,
			Algorithm:               "AES-256-GCM",
			KeyVersion:              "chat-dek-v1",
			PlaintextCommitment:     testPlaintextCommitment(text, salt, testTranslationCommitmentKey()),
			PlaintextCommitmentSalt: salt,
		}, now)
		if err != nil {
			t.Fatalf("SendMessage(%d): %v", index, err)
		}
		messages = append(messages, message)
	}
	return messages
}

func translationTestText(index int) string {
	return fmt.Sprintf("translation-%d", index)
}

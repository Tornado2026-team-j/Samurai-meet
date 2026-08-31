package chat

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func TestValidateMessageInputRequiresCiphertextContract(t *testing.T) {
	valid := SendMessageInput{
		ClientMessageID: "client-1",
		Ciphertext:      base64.RawURLEncoding.EncodeToString(make([]byte, 32)),
		Nonce:           base64.RawURLEncoding.EncodeToString(make([]byte, 12)),
		Algorithm:       "AES-256-GCM",
		KeyVersion:      "v1",
	}
	if err := validateMessageInput(valid); err != nil {
		t.Fatalf("valid message rejected: %v", err)
	}
	for _, test := range []struct {
		name  string
		input SendMessageInput
		want  error
	}{
		{name: "plaintext", input: SendMessageInput{ClientMessageID: "id", Ciphertext: "hello", Nonce: valid.Nonce, Algorithm: valid.Algorithm, KeyVersion: valid.KeyVersion}, want: ErrChatInvalidInput},
		{name: "wrong nonce", input: func() SendMessageInput {
			copy := valid
			copy.Nonce = base64.RawURLEncoding.EncodeToString(make([]byte, 11))
			return copy
		}(), want: ErrChatInvalidInput},
		{name: "wrong algorithm", input: func() SendMessageInput { copy := valid; copy.Algorithm = "plaintext"; return copy }(), want: ErrChatInvalidInput},
		{name: "control client id", input: func() SendMessageInput { copy := valid; copy.ClientMessageID = "id\n"; return copy }(), want: ErrChatInvalidInput},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateMessageInput(test.input); !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}

	tooLarge := valid
	tooLarge.Ciphertext = base64.RawURLEncoding.EncodeToString(make([]byte, maxCiphertextBytes+1))
	if err := validateMessageInput(tooLarge); !errors.Is(err, ErrMessageTooLarge) {
		t.Fatalf("large message error = %v, want ErrMessageTooLarge", err)
	}
	if strings.Contains(valid.Ciphertext, "hello") {
		t.Fatal("test ciphertext unexpectedly contains plaintext")
	}

	location := valid
	location.ContentType = "location"
	location.ExpiresAt = time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
	if err := validateMessageInput(location); err != nil {
		t.Fatalf("valid location metadata rejected: %v", err)
	}
	location.ExpiresAt = time.Now().Add(25 * time.Hour).UTC().Format(time.RFC3339Nano)
	if err := validateMessageInput(location); !errors.Is(err, ErrChatInvalidInput) {
		t.Fatalf("overlong location expiry error = %v, want invalid input", err)
	}
}

// TestIssueTransportTokenRejectsUnsupportedTransport locks the contract that
// only `webtransport` is issuable. Legacy WebSocket and arbitrary transports
// must never receive a token. Transport validation runs before
// any DB access, so a nil-db service is enough to exercise it.
func TestIssueTransportTokenRejectsUnsupportedTransport(t *testing.T) {
	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(make([]byte, 32)), "chat-issuer", "chat-audience")
	if err != nil {
		t.Fatalf("NewSigner() error = %v", err)
	}
	service := NewService(nil, signer)
	for _, transport := range []string{"websocket", "quic", "h3", "grpc"} {
		if _, err := service.IssueTransportToken(context.Background(), "user-1", "session-1", "chat-1", transport, time.Now()); !errors.Is(err, ErrChatInvalidInput) {
			t.Fatalf("transport %q error = %v, want ErrChatInvalidInput", transport, err)
		}
	}
}

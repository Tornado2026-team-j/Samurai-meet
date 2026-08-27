package chat

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
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
}

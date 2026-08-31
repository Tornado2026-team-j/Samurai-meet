package chat

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func TestValidateAttachmentInputContract(t *testing.T) {
	valid := AttachmentInput{
		ContentType: "image/jpeg",
		Nonce:       base64.RawURLEncoding.EncodeToString(make([]byte, 12)),
		Algorithm:   "AES-256-GCM",
		KeyVersion:  "chat-attachment-e2ee-v1",
	}
	if err := validateAttachmentInput(valid); err != nil {
		t.Fatalf("valid attachment rejected: %v", err)
	}

	for _, test := range []struct {
		name  string
		input AttachmentInput
	}{
		{"unsupported content type", func() AttachmentInput { c := valid; c.ContentType = "image/svg+xml"; return c }()},
		{"empty content type", func() AttachmentInput { c := valid; c.ContentType = ""; return c }()},
		{"wrong algorithm", func() AttachmentInput { c := valid; c.Algorithm = "AES-128-GCM"; return c }()},
		{"short nonce", func() AttachmentInput {
			c := valid
			c.Nonce = base64.RawURLEncoding.EncodeToString(make([]byte, 11))
			return c
		}()},
		{"non-base64 nonce", func() AttachmentInput { c := valid; c.Nonce = "not base64!!"; return c }()},
		{"blank key version", func() AttachmentInput { c := valid; c.KeyVersion = ""; return c }()},
		{"legacy key version", func() AttachmentInput { c := valid; c.KeyVersion = "chat-attachment-mvp-v1"; return c }()},
		{"whitespace key version", func() AttachmentInput { c := valid; c.KeyVersion = "a b"; return c }()},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateAttachmentInput(test.input); !errors.Is(err, ErrChatInvalidInput) {
				t.Fatalf("error = %v, want ErrChatInvalidInput", err)
			}
		})
	}
}

func TestSendMessageInputRejectsMalformedAttachmentID(t *testing.T) {
	base := SendMessageInput{
		ClientMessageID: "client-1",
		Ciphertext:      base64.RawURLEncoding.EncodeToString(make([]byte, 32)),
		Nonce:           base64.RawURLEncoding.EncodeToString(make([]byte, 12)),
		Algorithm:       "AES-256-GCM",
		KeyVersion:      "v1",
	}
	base.AttachmentID = "bad id\n"
	if err := validateMessageInput(base); !errors.Is(err, ErrChatInvalidInput) {
		t.Fatalf("error = %v, want ErrChatInvalidInput", err)
	}
	base.AttachmentID = strings.Repeat("a", maxClientMessageID+1)
	if err := validateMessageInput(base); !errors.Is(err, ErrChatInvalidInput) {
		t.Fatalf("oversized attachment id error = %v, want ErrChatInvalidInput", err)
	}
}

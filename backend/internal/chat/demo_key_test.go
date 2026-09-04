package chat

import (
	"bytes"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/accountscope"
)

func TestValidDemoPublicKeyRequiresCanonical32ByteBase64URL(t *testing.T) {
	encoded := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32))
	for name, value := range map[string]string{
		"canonical": encoded,
		"short":     base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 31)),
		"padded":    encoded + "=",
		"invalid":   "not-base64!",
		"empty":     "",
	} {
		t.Run(name, func(t *testing.T) {
			if got := validDemoPublicKey(value); got != (name == "canonical") {
				t.Fatalf("validDemoPublicKey(%q) = %v", name, got)
			}
		})
	}
}

func TestValidateMessageScopeKeepsDemoCiphertextSeparate(t *testing.T) {
	for _, test := range []struct {
		name        string
		accountType string
		keyVersion  string
		want        error
	}{
		{name: "demo protocol", accountType: accountscope.Demo, keyVersion: DemoChatKeyVersion},
		{name: "regular protocol", accountType: accountscope.Regular, keyVersion: "chat-dek-v1"},
		{name: "demo cannot use regular", accountType: accountscope.Demo, keyVersion: "chat-dek-v1", want: ErrChatInvalidInput},
		{name: "regular cannot use demo", accountType: accountscope.Regular, keyVersion: DemoChatKeyVersion, want: ErrChatInvalidInput},
		{name: "unknown account scope", accountType: "", keyVersion: DemoChatKeyVersion, want: ErrChatInvalidInput},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateMessageScope(test.accountType, test.keyVersion); !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

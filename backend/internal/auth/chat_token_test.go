package auth

import (
	"bytes"
	"encoding/base64"
	"testing"
	"time"
)

func TestChatTokenIsSeparateFromAccessToken(t *testing.T) {
	signer, err := NewSigner(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x4a}, 32)), "issuer", "access-audience")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.August, 26, 12, 0, 0, 0, time.UTC)
	token, claims, err := signer.IssueChatToken("user-1", "session-1", "chat-1", "websocket", now)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Audience != ChatAudience || claims.ChatID != "chat-1" || claims.Transport != "websocket" {
		t.Fatalf("chat claims = %+v", claims)
	}
	verified, err := signer.VerifyChatToken(token, now.Add(time.Second))
	if err != nil {
		t.Fatalf("VerifyChatToken() error = %v", err)
	}
	if verified != claims {
		t.Fatalf("verified claims = %+v, want %+v", verified, claims)
	}
	if _, err := signer.Verify(token, now.Add(time.Second)); err == nil {
		t.Fatal("chat token was accepted as an access token")
	}
	if _, err := signer.VerifyChatToken(token, now.Add(ChatTokenTTL)); err == nil {
		t.Fatal("expired chat token was accepted")
	}
}

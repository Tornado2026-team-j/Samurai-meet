package auth

import (
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"strings"
	"testing"
)

func TestNewPasskeyRelyingParty(t *testing.T) {
	rp, err := NewPasskeyRelyingParty(config.WebAuthnConfig{RPID: "localhost", RPOrigin: "http://localhost:5173", RPDisplayName: "Samurai Meet"})
	if err != nil || rp == nil {
		t.Fatalf("rp=%v err=%v", rp, err)
	}
}

func TestNewPasskeyRelyingPartyIncludesAdditionalOrigins(t *testing.T) {
	rp, err := NewPasskeyRelyingParty(config.WebAuthnConfig{
		RPID:                "samurai-meet.disnana.com",
		RPOrigin:            "https://samurai-meet.disnana.com",
		RPDisplayName:       "Samurai Meet",
		AdditionalRPOrigins: []string{"https://samurai-meet-expo-go-pre.disnana.com/"},
	})
	if err != nil {
		t.Fatalf("NewPasskeyRelyingParty() error = %v", err)
	}
	if got := strings.Join(rp.Config.GetOrigins(), ","); got != "https://samurai-meet.disnana.com,https://samurai-meet-expo-go-pre.disnana.com" {
		t.Fatalf("RP origins = %q", got)
	}
}

func TestPasskeyUserUsesHumanDisplayName(t *testing.T) {
	user := &passkeyUser{id: "random-user-id", displayName: "山田 太郎"}
	if got := user.WebAuthnName(); got != "山田 太郎" {
		t.Fatalf("WebAuthnName() = %q, want display name", got)
	}
	if got := normalizedDisplayName("\u0000", "user@example.com"); got != "user@example.com" {
		t.Fatalf("normalized fallback = %q", got)
	}
}

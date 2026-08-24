package auth

import (
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"testing"
)

func TestNewPasskeyRelyingParty(t *testing.T) {
	rp, err := NewPasskeyRelyingParty(config.WebAuthnConfig{RPID: "localhost", RPOrigin: "http://localhost:5173", RPDisplayName: "Samurai Meet"})
	if err != nil || rp == nil {
		t.Fatalf("rp=%v err=%v", rp, err)
	}
}

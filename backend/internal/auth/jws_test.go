package auth

import (
	"encoding/base64"
	"testing"
	"time"
)

func TestSignerIssuesAndVerifiesOneMinuteAccessToken(t *testing.T) {
	key := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	signer, err := NewSigner(key, "issuer", "audience")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	token, claims, err := signer.Issue("user", "session", "token", now)
	if err != nil {
		t.Fatal(err)
	}
	if claims.ExpiresAt-claims.IssuedAt != 60 {
		t.Fatal("unexpected TTL")
	}
	got, err := signer.Verify(token, now.Add(59*time.Second))
	if err != nil || got.SessionID != "session" {
		t.Fatalf("verify=%+v err=%v", got, err)
	}
	if _, err := signer.Verify(token, now.Add(time.Minute)); err == nil {
		t.Fatal("expired token accepted")
	}
}

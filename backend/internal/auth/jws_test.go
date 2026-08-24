package auth

import (
	"encoding/base64"
	"encoding/json"
	"strings"
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

func TestRotatingSignerUsesKeyIDAndKeepsOldKeyForVerification(t *testing.T) {
	oldKey := base64.RawURLEncoding.EncodeToString([]byte("01234567890123456789012345678901"))
	newKey := base64.RawURLEncoding.EncodeToString([]byte("abcdefghijklmnopqrstuvwxyz123456"))
	oldSigner, err := NewRotatingSigner("old", map[string]string{"old": oldKey}, "issuer", "audience")
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := oldSigner.Issue("user", "session", "token", time.Unix(100, 0))
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	var header map[string]string
	if raw, decodeErr := base64.RawURLEncoding.DecodeString(parts[0]); decodeErr != nil || json.Unmarshal(raw, &header) != nil || header["kid"] != "old" {
		t.Fatalf("unexpected header: %s", parts[0])
	}
	rotated, err := NewRotatingSigner("new", map[string]string{"old": oldKey, "new": newKey}, "issuer", "audience")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = rotated.Verify(token, time.Unix(101, 0)); err != nil {
		t.Fatalf("old token rejected during rotation: %v", err)
	}
	newToken, _, err := rotated.Issue("user", "session", "new-token", time.Unix(101, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = oldSigner.Verify(newToken, time.Unix(101, 0)); err == nil {
		t.Fatal("old signer accepted token signed by new key")
	}
	if _, err = rotated.Verify(newToken, time.Unix(101, 0)); err != nil {
		t.Fatal(err)
	}
}

func TestSignerRejectsUnknownOrInvalidJWSHeader(t *testing.T) {
	key := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	signer, err := NewSigner(key, "issuer", "audience")
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := signer.Issue("user", "session", "token", time.Unix(100, 0))
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	badHeader, _ := json.Marshal(map[string]string{"alg": "none", "typ": "JWT", "kid": "v1"})
	parts[0] = base64.RawURLEncoding.EncodeToString(badHeader)
	if _, err = signer.Verify(strings.Join(parts, "."), time.Unix(101, 0)); err == nil {
		t.Fatal("JWS with alg=none accepted")
	}
	badHeader, _ = json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT", "kid": "unknown"})
	parts[0] = base64.RawURLEncoding.EncodeToString(badHeader)
	if _, err = signer.Verify(strings.Join(parts, "."), time.Unix(101, 0)); err == nil {
		t.Fatal("JWS with unknown kid accepted")
	}
}

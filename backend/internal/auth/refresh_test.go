package auth

import (
	"strings"
	"testing"
)

func TestRefreshTokenIsOpaqueAndHashable(t *testing.T) {
	token, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(token, ".") != 0 {
		t.Fatal("refresh token must not be JWT")
	}
	hash, err := HashRefreshToken(token)
	if err != nil || len(hash) != 64 {
		t.Fatalf("hash=%q err=%v", hash, err)
	}
	if _, err := HashRefreshToken("invalid"); err == nil {
		t.Fatal("invalid token accepted")
	}
}

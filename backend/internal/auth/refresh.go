package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// NewRefreshToken returns an opaque 256-bit token. Only HashRefreshToken is stored.
func NewRefreshToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func HashRefreshToken(token string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != 32 {
		return "", fmt.Errorf("invalid refresh token")
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

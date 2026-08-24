package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type AccessClaims struct {
	Issuer    string `json:"iss"`
	Audience  string `json:"aud"`
	Subject   string `json:"sub"`
	SessionID string `json:"sid"`
	TokenID   string `json:"jti"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}
type Signer struct {
	key              []byte
	issuer, audience string
}

func NewSigner(encodedKey, issuer, audience string) (*Signer, error) {
	key, err := base64.RawURLEncoding.DecodeString(encodedKey)
	if err != nil || len(key) < 32 {
		return nil, errors.New("JWS_SIGNING_KEY must be a Base64URL-encoded value of at least 32 bytes")
	}
	return &Signer{key, issuer, audience}, nil
}
func (s *Signer) Issue(userID, sessionID, tokenID string, now time.Time) (string, AccessClaims, error) {
	claims := AccessClaims{s.issuer, s.audience, userID, sessionID, tokenID, now.Unix(), now.Add(AccessTokenTTL).Unix()}
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", AccessClaims{}, err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), claims, nil
}
func (s *Signer) Verify(token string, now time.Time) (AccessClaims, error) {
	p := strings.Split(token, ".")
	if len(p) != 3 {
		return AccessClaims{}, errors.New("invalid JWS format")
	}
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write([]byte(p[0] + "." + p[1]))
	sig, err := base64.RawURLEncoding.DecodeString(p[2])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return AccessClaims{}, errors.New("invalid JWS signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(p[1])
	if err != nil {
		return AccessClaims{}, err
	}
	var c AccessClaims
	if err = json.Unmarshal(raw, &c); err != nil {
		return AccessClaims{}, err
	}
	if c.Issuer != s.issuer || c.Audience != s.audience || c.Subject == "" || c.SessionID == "" || c.TokenID == "" || now.Unix() >= c.ExpiresAt {
		return AccessClaims{}, fmt.Errorf("invalid JWS claims")
	}
	return c, nil
}

// Seal protects short-lived server-side retry responses. The signing key is
// never exposed, and the nonce is safe to persist alongside ciphertext.
func (s *Signer) Seal(plaintext []byte) (ciphertext, nonce string, err error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", err
	}
	rawNonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(rawNonce); err != nil {
		return "", "", err
	}
	sealed := gcm.Seal(nil, rawNonce, plaintext, nil)
	return base64.RawURLEncoding.EncodeToString(sealed), base64.RawURLEncoding.EncodeToString(rawNonce), nil
}

func (s *Signer) Open(ciphertext, nonce string) ([]byte, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, err
	}
	rawNonce, err := base64.RawURLEncoding.DecodeString(nonce)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, rawNonce, sealed, nil)
}

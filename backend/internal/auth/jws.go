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
	keys             map[string][]byte
	activeKeyID      string
	issuer, audience string
}

func NewSigner(encodedKey, issuer, audience string) (*Signer, error) {
	return NewRotatingSigner("v1", map[string]string{"v1": encodedKey}, issuer, audience)
}

// NewRotatingSigner creates a signer with one active key and an allow-list of
// verification keys. The active key is used for newly issued JWS and sealed
// retry data; old keys remain available for verification/decryption during a
// bounded rotation window.
func NewRotatingSigner(activeKeyID string, encodedKeys map[string]string, issuer, audience string) (*Signer, error) {
	if !validKeyID(activeKeyID) {
		return nil, errors.New("JWS active key ID is invalid")
	}
	if len(encodedKeys) == 0 {
		return nil, errors.New("at least one JWS verification key is required")
	}
	keys := make(map[string][]byte, len(encodedKeys))
	for keyID, encodedKey := range encodedKeys {
		if !validKeyID(keyID) {
			return nil, errors.New("JWS verification key ID is invalid")
		}
		key, err := base64.RawURLEncoding.DecodeString(encodedKey)
		if err != nil || len(key) != 32 {
			return nil, errors.New("JWS keys must be Base64URL-encoded values of exactly 32 bytes")
		}
		keys[keyID] = append([]byte(nil), key...)
	}
	if _, ok := keys[activeKeyID]; !ok {
		return nil, errors.New("active JWS key ID is not present in the verification key set")
	}
	return &Signer{keys: keys, activeKeyID: activeKeyID, issuer: issuer, audience: audience}, nil
}

func validKeyID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' && r != '.' {
			return false
		}
	}
	return true
}
func (s *Signer) Issue(userID, sessionID, tokenID string, now time.Time) (string, AccessClaims, error) {
	claims := AccessClaims{s.issuer, s.audience, userID, sessionID, tokenID, now.Unix(), now.Add(AccessTokenTTL).Unix()}
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT", "kid": s.activeKeyID})
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", AccessClaims{}, err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.keys[s.activeKeyID])
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), claims, nil
}
func (s *Signer) Verify(token string, now time.Time) (AccessClaims, error) {
	if len(token) > 4096 {
		return AccessClaims{}, errors.New("JWS token is too large")
	}
	p := strings.Split(token, ".")
	if len(p) != 3 {
		return AccessClaims{}, errors.New("invalid JWS format")
	}
	headerRaw, err := base64.RawURLEncoding.DecodeString(p[0])
	if err != nil {
		return AccessClaims{}, errors.New("invalid JWS header")
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
		KeyID     string `json:"kid"`
	}
	if err = json.Unmarshal(headerRaw, &header); err != nil || header.Algorithm != "HS256" || header.Type != "JWT" || !validKeyID(header.KeyID) {
		return AccessClaims{}, errors.New("invalid JWS header")
	}
	key, ok := s.keys[header.KeyID]
	if !ok {
		return AccessClaims{}, errors.New("unknown JWS key ID")
	}
	mac := hmac.New(sha256.New, key)
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
	if c.Issuer != s.issuer || c.Audience != s.audience || c.Subject == "" || c.SessionID == "" || c.TokenID == "" || c.IssuedAt <= 0 || c.ExpiresAt <= c.IssuedAt || c.ExpiresAt-c.IssuedAt > int64(AccessTokenTTL/time.Second) || c.IssuedAt > now.Add(time.Minute).Unix() || now.Unix() >= c.ExpiresAt {
		return AccessClaims{}, fmt.Errorf("invalid JWS claims")
	}
	return c, nil
}

// Seal protects short-lived server-side retry responses. The signing key is
// never exposed, and the nonce is safe to persist alongside ciphertext.
func (s *Signer) Seal(plaintext []byte) (ciphertext, nonce string, err error) {
	block, err := aes.NewCipher(s.keys[s.activeKeyID])
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
	sealed, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, err
	}
	rawNonce, err := base64.RawURLEncoding.DecodeString(nonce)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, key := range s.keys {
		block, blockErr := aes.NewCipher(key)
		if blockErr != nil {
			lastErr = blockErr
			continue
		}
		gcm, gcmErr := cipher.NewGCM(block)
		if gcmErr != nil {
			lastErr = gcmErr
			continue
		}
		plaintext, openErr := gcm.Open(nil, rawNonce, sealed, nil)
		if openErr == nil {
			return plaintext, nil
		}
		lastErr = openErr
	}
	if lastErr == nil {
		lastErr = errors.New("no JWS decryption keys configured")
	}
	return nil, lastErr
}

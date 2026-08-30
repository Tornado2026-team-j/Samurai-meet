package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const ChatAudience = "samurai-meet-chat"

// ChatTokenTTL is the Chat Token lifetime. It is a var, not a const, so an
// integration test can shorten it to exercise in-connection rotation and the
// heartbeat's token-expiry disconnect without waiting two minutes.
var ChatTokenTTL = 2 * time.Minute

// ChatClaims are intentionally separate from AccessClaims. A chat token is
// accepted only by a chat transport after the chat ID and active session have
// been checked again.
type ChatClaims struct {
	Issuer    string `json:"iss"`
	Audience  string `json:"aud"`
	Subject   string `json:"sub"`
	SessionID string `json:"sid"`
	ChatID    string `json:"chat_id"`
	TokenID   string `json:"jti"`
	Transport string `json:"transport"`
	TokenSeq  int64  `json:"token_seq"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

// IssueChatToken mints a Chat Token. tokenSeq is a per-(session, chat)
// monotonic generation number supplied by the caller; a live connection uses it
// to reject rotation to an older Chat Token.
func (s *Signer) IssueChatToken(userID, sessionID, chatID, transport string, tokenSeq int64, now time.Time) (string, ChatClaims, error) {
	if s == nil || len(s.keys[s.activeKeyID]) == 0 || userID == "" || sessionID == "" || chatID == "" || transport == "" {
		return "", ChatClaims{}, errors.New("chat signer is not configured")
	}
	claims := ChatClaims{
		Issuer:    s.issuer,
		Audience:  ChatAudience,
		Subject:   userID,
		SessionID: sessionID,
		ChatID:    chatID,
		TokenID:   newID(),
		Transport: transport,
		TokenSeq:  tokenSeq,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(ChatTokenTTL).Unix(),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", ChatClaims{}, err
	}
	return s.signToken(payload, "CHAT"), claims, nil
}

func (s *Signer) VerifyChatToken(token string, now time.Time) (ChatClaims, error) {
	payload, err := s.verifyToken(token, "CHAT")
	if err != nil {
		return ChatClaims{}, err
	}
	var claims ChatClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ChatClaims{}, err
	}
	if claims.Issuer != s.issuer || claims.Audience != ChatAudience ||
		claims.Subject == "" || claims.SessionID == "" || claims.ChatID == "" ||
		claims.TokenID == "" || claims.Transport == "" || claims.TokenSeq < 0 ||
		now.Unix() >= claims.ExpiresAt {
		return ChatClaims{}, fmt.Errorf("invalid chat token claims")
	}
	return claims, nil
}

func (s *Signer) signToken(payload []byte, tokenType string) string {
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": tokenType, "kid": s.activeKeyID})
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.keys[s.activeKeyID])
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Signer) verifyToken(token, expectedType string) ([]byte, error) {
	if s == nil {
		return nil, errors.New("signer is not configured")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}
	headerRaw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("invalid token header")
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
		KeyID     string `json:"kid"`
	}
	if err := json.Unmarshal(headerRaw, &header); err != nil || header.Algorithm != "HS256" || header.Type != expectedType || !validKeyID(header.KeyID) {
		return nil, errors.New("invalid token header")
	}
	key, ok := s.keys[header.KeyID]
	if !ok {
		return nil, errors.New("unknown token key ID")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, mac.Sum(nil)) {
		return nil, errors.New("invalid token signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid token payload")
	}
	return payload, nil
}

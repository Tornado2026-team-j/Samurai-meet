package identity

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	ErrUnavailable    = errors.New("identity verification unavailable")
	ErrInvalidWebhook = errors.New("invalid identity webhook")
)

type Service struct {
	db            *sql.DB
	secretKey     string
	webhookSecret string
	returnURL     string
	httpClient    *http.Client
	endpoint      string
}

type VerificationSession struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Status string `json:"status"`
}

func NewService(db *sql.DB, secretKey, webhookSecret, returnURL string) *Service {
	return &Service{
		db: db, secretKey: strings.TrimSpace(secretKey), webhookSecret: strings.TrimSpace(webhookSecret),
		returnURL: strings.TrimSpace(returnURL), httpClient: &http.Client{Timeout: 10 * time.Second},
		endpoint: "https://api.stripe.com/v1/identity/verification_sessions",
	}
}

func (s *Service) Available() bool {
	return s != nil && s.db != nil && s.secretKey != "" && s.returnURL != ""
}

func (s *Service) CreateSession(ctx context.Context, userID string, now time.Time) (VerificationSession, error) {
	if !s.Available() || strings.TrimSpace(userID) == "" {
		return VerificationSession{}, ErrUnavailable
	}
	form := url.Values{}
	form.Set("type", "document")
	form.Set("metadata[user_id]", userID)
	form.Set("return_url", s.returnURL)
	form.Set("options[document][require_matching_selfie]", "true")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return VerificationSession{}, err
	}
	req.Header.Set("Authorization", "Bearer "+s.secretKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return VerificationSession{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return VerificationSession{}, ErrUnavailable
	}
	var result VerificationSession
	if err := json.Unmarshal(body, &result); err != nil || result.ID == "" || result.URL == "" {
		return VerificationSession{}, ErrUnavailable
	}
	localID, err := randomID()
	if err != nil {
		return VerificationSession{}, err
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return VerificationSession{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO identity_verifications (id,user_id,provider_session_id,status,created_at,updated_at)
		VALUES ($1,$2,$3,'pending',$4,$4)`, localID, userID, result.ID, stamp); err != nil {
		return VerificationSession{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE profiles SET identity_status='pending',updated_at=$1 WHERE user_id=$2`, stamp, userID); err != nil {
		return VerificationSession{}, err
	}
	if err = tx.Commit(); err != nil {
		return VerificationSession{}, err
	}
	result.Status = "pending"
	return result, nil
}

func (s *Service) HandleWebhook(ctx context.Context, signature string, body []byte, now time.Time) error {
	if s == nil || s.db == nil || s.webhookSecret == "" || !validStripeSignature(signature, body, s.webhookSecret, now) {
		return ErrInvalidWebhook
	}
	var event struct {
		Type string `json:"type"`
		Data struct {
			Object struct {
				ID       string            `json:"id"`
				Status   string            `json:"status"`
				Metadata map[string]string `json:"metadata"`
			} `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return ErrInvalidWebhook
	}
	status := ""
	switch event.Type {
	case "identity.verification_session.verified":
		status = "verified"
	case "identity.verification_session.requires_input", "identity.verification_session.canceled":
		status = "rejected"
	case "identity.verification_session.processing":
		status = "pending"
	default:
		return nil
	}
	providerID := strings.TrimSpace(event.Data.Object.ID)
	userID := strings.TrimSpace(event.Data.Object.Metadata["user_id"])
	if providerID == "" || userID == "" {
		return ErrInvalidWebhook
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE identity_verifications SET status=$1,updated_at=$2 WHERE provider_session_id=$3 AND user_id=$4`, status, stamp, providerID, userID)
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err != nil || count == 0 {
		return ErrInvalidWebhook
	}
	if _, err = tx.ExecContext(ctx, `UPDATE profiles SET identity_status=$1,updated_at=$2 WHERE user_id=$3`, status, stamp, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func validStripeSignature(header string, body []byte, secret string, now time.Time) bool {
	var timestamp string
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, found := strings.Cut(strings.TrimSpace(part), "=")
		if !found {
			continue
		}
		if key == "t" {
			timestamp = value
		} else if key == "v1" {
			signatures = append(signatures, value)
		}
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || len(signatures) == 0 || time.Unix(seconds, 0).Before(now.Add(-5*time.Minute)) || time.Unix(seconds, 0).After(now.Add(5*time.Minute)) {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(body)
	expected := mac.Sum(nil)
	for _, signature := range signatures {
		decoded, err := hex.DecodeString(signature)
		if err == nil && hmac.Equal(decoded, expected) {
			return true
		}
	}
	return false
}

func randomID() (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

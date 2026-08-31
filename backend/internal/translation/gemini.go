// Package translation turns one short chat message into another language on
// demand. Like the recruitment classifier it keeps the Gemini API key and the
// raw model response on the server; the client only ever sees the translated
// text it explicitly asked for.
package translation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const DefaultModel = "gemini-3.1-flash-lite"
const PlaceholderAPIKey = "CHANGE_ME_GEMINI_API_KEY"

const maxSourceRunes = 2000

// SupportedTargets are the UI languages a message can be translated into. They
// mirror the frontend AppLanguage values.
var SupportedTargets = map[string]string{
	"en": "English",
	"ja": "Japanese",
}

var (
	ErrUnavailable  = errors.New("translation is unavailable")
	ErrInvalidInput = errors.New("invalid translation input")
	ErrRateLimited  = errors.New("translation rate limited")
	ErrUpstream     = errors.New("translation failed")
)

type Service struct {
	apiKey     string
	model      string
	endpoint   string
	httpClient *http.Client
	mu         sync.Mutex
	lastByUser map[string]time.Time
}

func NewGemini(apiKey, model string) *Service {
	return NewGeminiWithClient(apiKey, model, "https://generativelanguage.googleapis.com", &http.Client{Timeout: 8 * time.Second})
}

func NewGeminiWithClient(apiKey, model, endpoint string, httpClient *http.Client) *Service {
	if strings.TrimSpace(model) == "" {
		model = DefaultModel
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}
	return &Service{
		apiKey:     strings.TrimSpace(apiKey),
		model:      strings.TrimSpace(model),
		endpoint:   strings.TrimRight(strings.TrimSpace(endpoint), "/"),
		httpClient: httpClient,
		lastByUser: make(map[string]time.Time),
	}
}

func (s *Service) Available() bool {
	return s != nil && s.apiKey != "" && s.apiKey != PlaceholderAPIKey && s.endpoint != ""
}

// Translate returns text rendered in the target language. targetLanguage must be
// one of SupportedTargets. Text that is already in the target language may be
// returned unchanged by the model.
func (s *Service) Translate(ctx context.Context, userID, text, targetLanguage string) (string, error) {
	text = strings.TrimSpace(text)
	targetLanguage = strings.ToLower(strings.TrimSpace(targetLanguage))
	targetName, ok := SupportedTargets[targetLanguage]
	if !ok || text == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > maxSourceRunes {
		return "", ErrInvalidInput
	}
	if !s.Available() {
		return "", ErrUnavailable
	}
	if !s.allow(userID, time.Now()) {
		return "", ErrRateLimited
	}

	body, err := json.Marshal(map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": fmt.Sprintf(
			"You translate a single short chat message between two people meeting for a local tour. Translate the user's message into %s. Reply with only the translated text: no quotes, no romanization, no notes, no alternatives. If the message is already in %s, repeat it unchanged. Preserve emoji and place names.",
			targetName, targetName)}}},
		"contents": []map[string]any{{"role": "user", "parts": []map[string]string{{"text": text}}}},
		"generationConfig": map[string]any{
			"temperature":      0,
			"maxOutputTokens":  512,
			"responseMimeType": "text/plain",
		},
	})
	if err != nil {
		return "", ErrUpstream
	}

	requestURL := fmt.Sprintf("%s/v1beta/models/%s:generateContent", s.endpoint, url.PathEscape(s.model))
	parsedURL, err := url.Parse(requestURL)
	if err != nil {
		return "", ErrUpstream
	}
	query := parsedURL.Query()
	query.Set("key", s.apiKey)
	parsedURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsedURL.String(), bytes.NewReader(body))
	if err != nil {
		return "", ErrUpstream
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", ErrUpstream
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil || resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", ErrUpstream
	}

	var response struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(responseBody, &response); err != nil || len(response.Candidates) != 1 {
		return "", ErrUpstream
	}
	var builder strings.Builder
	for _, part := range response.Candidates[0].Content.Parts {
		builder.WriteString(part.Text)
	}
	translated := strings.TrimSpace(builder.String())
	if translated == "" || !utf8.ValidString(translated) || utf8.RuneCountInString(translated) > 4*maxSourceRunes {
		return "", ErrUpstream
	}
	return translated, nil
}

func (s *Service) allow(userID string, now time.Time) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if last, found := s.lastByUser[userID]; found && now.Sub(last) < time.Second {
		return false
	}
	s.lastByUser[userID] = now
	return true
}

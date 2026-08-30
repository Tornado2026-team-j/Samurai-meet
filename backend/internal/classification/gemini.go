// Package classification maps a recruitment description to the small, stable
// set of categories used by matching. It intentionally keeps the Gemini API
// key and the raw model response on the server.
package classification

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
)

const DefaultModel = "gemini-3.1-flash-lite"

var (
	ErrUnavailable  = errors.New("recruitment classification is unavailable")
	ErrInvalidInput = errors.New("invalid recruitment description")
	ErrRateLimited  = errors.New("recruitment classification rate limited")
	ErrUpstream     = errors.New("recruitment classification failed")
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
		apiKey: strings.TrimSpace(apiKey), model: strings.TrimSpace(model),
		endpoint: strings.TrimRight(strings.TrimSpace(endpoint), "/"), httpClient: httpClient,
		lastByUser: make(map[string]time.Time),
	}
}

func (s *Service) Available() bool {
	return s != nil && s.apiKey != "" && s.endpoint != ""
}

func (s *Service) Classify(ctx context.Context, userID, description string) (string, error) {
	description = strings.TrimSpace(description)
	if len(description) == 0 || len(description) > 2_000 {
		return "", ErrInvalidInput
	}
	if !s.Available() {
		return "", ErrUnavailable
	}
	if !s.allow(userID, time.Now()) {
		return "", ErrRateLimited
	}

	body, err := json.Marshal(map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": "Classify the recruitment request into exactly one category. Reply with only one exact token: Food, Places, Activity, or Other. Food is eating, drinking, restaurants, cooking, or food markets. Places is visiting locations, sightseeing, culture, history, museums, temples, neighborhoods, or shopping. Activity is a physical, recreational, or participatory activity. Other is only for requests that do not fit the first three."}}},
		"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": description}}}},
		"generationConfig":  map[string]any{"temperature": 0, "maxOutputTokens": 8, "responseMimeType": "text/plain"},
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
	if err := json.Unmarshal(responseBody, &response); err != nil || len(response.Candidates) != 1 || len(response.Candidates[0].Content.Parts) != 1 {
		return "", ErrUpstream
	}
	category := strings.TrimSpace(response.Candidates[0].Content.Parts[0].Text)
	switch category {
	case "Food", "Places", "Activity", "Other":
		return category, nil
	default:
		return "", ErrUpstream
	}
}

func (s *Service) allow(userID string, now time.Time) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if last, found := s.lastByUser[userID]; found && now.Sub(last) < 2*time.Second {
		return false
	}
	s.lastByUser[userID] = now
	return true
}

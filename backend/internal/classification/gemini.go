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
	"unicode"
	"unicode/utf8"
)

const DefaultModel = "gemini-3.1-flash-lite"
const PlaceholderAPIKey = "CHANGE_ME_GEMINI_API_KEY"

const (
	CategoryFood     = "Food"
	CategoryPlaces   = "Places"
	CategoryActivity = "Activity"
	CategoryOther    = "Other"
)

const (
	maxClassificationKeywords     = 5
	maxClassificationKeywordRunes = 40
	maxClassificationOutputTokens = 256
)

type ClassificationResult struct {
	Category string
	Keywords []string
}

var (
	ErrUnavailable         = errors.New("recruitment classification is unavailable")
	ErrInvalidInput        = errors.New("invalid recruitment description")
	ErrRateLimited         = errors.New("recruitment classification rate limited")
	ErrProviderRateLimited = errors.New("recruitment classification provider rate limited")
	ErrProviderUnavailable = errors.New("recruitment classification provider unavailable")
	ErrUpstream            = errors.New("recruitment classification failed")
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
	return s != nil && s.apiKey != "" && s.apiKey != PlaceholderAPIKey && s.endpoint != ""
}

func (s *Service) Classify(ctx context.Context, userID, description string) (string, error) {
	result, err := s.ClassifyWithKeywords(ctx, userID, description)
	return result.Category, err
}

func (s *Service) ClassifyWithKeywords(ctx context.Context, userID, description string) (ClassificationResult, error) {
	description = strings.TrimSpace(description)
	if len(description) == 0 || len(description) > 2_000 {
		return ClassificationResult{}, ErrInvalidInput
	}
	if !s.Available() {
		return ClassificationResult{}, ErrUnavailable
	}
	if !s.allow(userID, time.Now()) {
		return ClassificationResult{}, ErrRateLimited
	}

	body, err := json.Marshal(map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": "Classify the recruitment request into exactly one category and generate up to five short search keywords. Reply with only strict JSON using exactly these fields: category and keywords. category must be exactly Food, Places, Activity, or Other. keywords must be a JSON array of short, safe, useful strings, with no empty strings, control characters, or explanations. Food is eating, drinking, restaurants, cooking, or food markets. Places is visiting locations, sightseeing, culture, history, museums, temples, neighborhoods, or shopping. Activity is a physical, recreational, or participatory activity. Other is only for requests that do not fit the first three."}}},
		"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": description}}}},
		"generationConfig": map[string]any{
			"temperature":      0,
			"maxOutputTokens":  maxClassificationOutputTokens,
			"responseMimeType": "application/json",
			"responseSchema": map[string]any{
				"type": "OBJECT",
				"properties": map[string]any{
					"category": map[string]any{"type": "STRING", "enum": []string{CategoryFood, CategoryPlaces, CategoryActivity, CategoryOther}},
					"keywords": map[string]any{"type": "ARRAY", "items": map[string]any{"type": "STRING"}},
				},
				"required": []string{"category", "keywords"},
			},
		},
	})
	if err != nil {
		return ClassificationResult{}, ErrUpstream
	}

	requestURL := fmt.Sprintf("%s/v1beta/models/%s:generateContent", s.endpoint, url.PathEscape(s.model))
	parsedURL, err := url.Parse(requestURL)
	if err != nil {
		return ClassificationResult{}, ErrUpstream
	}
	query := parsedURL.Query()
	query.Set("key", s.apiKey)
	parsedURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsedURL.String(), bytes.NewReader(body))
	if err != nil {
		return ClassificationResult{}, ErrUpstream
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ClassificationResult{}, ErrUpstream
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return ClassificationResult{}, ErrProviderRateLimited
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return ClassificationResult{}, ErrProviderUnavailable
	}
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil || resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return ClassificationResult{}, ErrUpstream
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
		return ClassificationResult{}, ErrUpstream
	}
	result, err := parseClassificationJSON(response.Candidates[0].Content.Parts[0].Text)
	if err != nil {
		return ClassificationResult{}, ErrUpstream
	}
	return result, nil
}

func parseClassificationJSON(text string) (ClassificationResult, error) {
	var payload struct {
		Category json.RawMessage `json:"category"`
		Keywords json.RawMessage `json:"keywords"`
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return ClassificationResult{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return ClassificationResult{}, errors.New("classification response has trailing data")
		}
		return ClassificationResult{}, err
	}
	if len(payload.Category) == 0 || len(payload.Keywords) == 0 || string(bytes.TrimSpace(payload.Keywords)) == "null" {
		return ClassificationResult{}, errors.New("classification response is incomplete")
	}

	var category string
	if err := json.Unmarshal(payload.Category, &category); err != nil {
		return ClassificationResult{}, err
	}
	category = strings.TrimSpace(category)
	switch category {
	case CategoryFood, CategoryPlaces, CategoryActivity, CategoryOther:
	default:
		return ClassificationResult{}, errors.New("unsupported classification category")
	}

	var keywords []string
	if err := json.Unmarshal(payload.Keywords, &keywords); err != nil {
		return ClassificationResult{}, err
	}
	if len(keywords) > maxClassificationKeywords {
		return ClassificationResult{}, errors.New("too many classification keywords")
	}
	normalized := make([]string, 0, len(keywords))
	seen := make(map[string]struct{}, len(keywords))
	for _, keyword := range keywords {
		keyword = strings.TrimSpace(keyword)
		if keyword == "" || !utf8.ValidString(keyword) || utf8.RuneCountInString(keyword) > maxClassificationKeywordRunes {
			return ClassificationResult{}, errors.New("invalid classification keyword")
		}
		for _, r := range keyword {
			if unicode.IsControl(r) {
				return ClassificationResult{}, errors.New("invalid classification keyword")
			}
		}
		key := strings.ToLower(keyword)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, keyword)
	}
	if len(normalized) == 0 {
		normalized = []string{"Experience"}
	}
	return ClassificationResult{Category: category, Keywords: normalized}, nil
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

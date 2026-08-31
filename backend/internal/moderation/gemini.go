// Package moderation runs an AI check over one decrypted chat message and
// reports which safety categories it hits and how severe it is. Like the
// recruitment classifier and the translator it keeps the Gemini API key and
// the raw model response on the server.
package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const DefaultModel = "gemini-3.1-flash-lite"
const PlaceholderAPIKey = "CHANGE_ME_GEMINI_API_KEY"

const maxSourceRunes = 2000

// Category values mirror the frontend ChatModerationCategory union.
var categories = []string{
	"abuse", "sexual", "money", "external_contact",
	"dangerous_place", "personal_info", "coercion",
}

// blockingCategories force severity "block" regardless of what the model
// returns: sharing external contacts or personal identifiers is never allowed.
var blockingCategories = map[string]bool{
	"external_contact": true,
	"personal_info":    true,
}

var (
	ErrUnavailable  = errors.New("moderation is unavailable")
	ErrInvalidInput = errors.New("invalid moderation input")
	ErrRateLimited  = errors.New("moderation rate limited")
	ErrUpstream     = errors.New("moderation failed")
)

// Result is the verdict for one message. Severity is "none", "warn" or "block".
type Result struct {
	Categories []string `json:"categories"`
	Severity   string   `json:"severity"`
}

// Flagged reports whether the message needs operator review.
func (r Result) Flagged() bool { return r.Severity == "warn" || r.Severity == "block" }

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

// Inspect classifies text against the safety categories. It never raises on
// borderline content: a clean message returns severity "none" with no
// categories.
func (s *Service) Inspect(ctx context.Context, userID, text string) (Result, error) {
	text = strings.TrimSpace(text)
	if text == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > maxSourceRunes {
		return Result{}, ErrInvalidInput
	}
	if !s.Available() {
		return Result{}, ErrUnavailable
	}
	if !s.allow(userID, time.Now()) {
		return Result{}, ErrRateLimited
	}

	body, err := json.Marshal(map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": "You screen one chat message between two strangers arranging to meet for a local tour. Reply with only strict JSON using exactly these fields: categories and severity. categories is a JSON array (possibly empty) drawn only from: abuse (insults, slurs, discrimination, threats of violence), sexual (sexual content or advances), money (payment, transfers, tips, investment, or fraud), external_contact (phone numbers, emails, LINE/Instagram/Telegram/WhatsApp or other off-platform handles), dangerous_place (pushing to meet somewhere isolated, private, or unsafe), personal_info (home address, passport, ID, or card numbers), coercion (pressuring or threatening the other person). severity is none when categories is empty, block when the message shares external contacts or personal identifiers, otherwise warn. Do not explain."}}},
		"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": text}}}},
		"generationConfig": map[string]any{
			"temperature":      0,
			"maxOutputTokens":  128,
			"responseMimeType": "application/json",
			"responseSchema": map[string]any{
				"type": "OBJECT",
				"properties": map[string]any{
					"categories": map[string]any{"type": "ARRAY", "items": map[string]any{"type": "STRING", "enum": categories}},
					"severity":   map[string]any{"type": "STRING", "enum": []string{"none", "warn", "block"}},
				},
				"required": []string{"categories", "severity"},
			},
		},
	})
	if err != nil {
		return Result{}, ErrUpstream
	}

	requestURL := fmt.Sprintf("%s/v1beta/models/%s:generateContent", s.endpoint, url.PathEscape(s.model))
	parsedURL, err := url.Parse(requestURL)
	if err != nil {
		return Result{}, ErrUpstream
	}
	query := parsedURL.Query()
	query.Set("key", s.apiKey)
	parsedURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsedURL.String(), bytes.NewReader(body))
	if err != nil {
		return Result{}, ErrUpstream
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return Result{}, ErrUpstream
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil || resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return Result{}, ErrUpstream
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
		return Result{}, ErrUpstream
	}
	return parseInspectionJSON(response.Candidates[0].Content.Parts[0].Text)
}

func parseInspectionJSON(text string) (Result, error) {
	var payload struct {
		Categories []string `json:"categories"`
		Severity   string   `json:"severity"`
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return Result{}, ErrUpstream
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return Result{}, ErrUpstream
	}

	allowed := make(map[string]bool, len(categories))
	for _, category := range categories {
		allowed[category] = false
	}
	seen := make(map[string]bool)
	normalized := make([]string, 0, len(payload.Categories))
	for _, category := range payload.Categories {
		category = strings.ToLower(strings.TrimSpace(category))
		if _, ok := allowed[category]; !ok {
			return Result{}, ErrUpstream
		}
		if !seen[category] {
			seen[category] = true
			normalized = append(normalized, category)
		}
	}
	sort.Strings(normalized)

	severity := strings.ToLower(strings.TrimSpace(payload.Severity))
	switch severity {
	case "none", "warn", "block":
	default:
		return Result{}, ErrUpstream
	}
	if len(normalized) == 0 {
		return Result{Categories: normalized, Severity: "none"}, nil
	}
	if severity == "none" {
		severity = "warn"
	}
	for _, category := range normalized {
		if blockingCategories[category] {
			severity = "block"
		}
	}
	return Result{Categories: normalized, Severity: severity}, nil
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

package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// ModerationDecision is the only moderation data exposed to a chat client.
// Provider categories, scores, request bodies, and raw provider responses are
// deliberately never persisted, logged, or returned by this package.
type ModerationDecision string

const (
	ModerationAllowed     ModerationDecision = "allowed"
	ModerationBlocked     ModerationDecision = "blocked"
	ModerationUnavailable ModerationDecision = "unavailable"
)

const (
	moderationModel       = "omni-moderation-latest"
	moderationTimeout     = 5 * time.Second
	maxModerationResponse = 64 * 1024
)

var ErrModerationUnavailable = errors.New("chat moderation is unavailable")

// ModerationProvider receives plaintext only for the lifetime of this request.
// Implementations must return a decision only and must not retain input.
type ModerationProvider interface {
	Moderate(context.Context, string) (ModerationDecision, error)
}

// NewModerationProvider selects the configured chat moderation boundary. The
// explicit temporary free-mode switch wins so a stale inherited API key cannot
// silently keep a test process on the unavailable OpenAI path. Without that
// switch, a configured OpenAI provider is used and every environment remains
// fail-closed when OpenAI is unavailable.
func NewModerationProvider(apiKey string, allowDevelopmentFreeMode bool) ModerationProvider {
	if allowDevelopmentFreeMode {
		return NewDevelopmentModerationProvider()
	}
	if provider := NewOpenAIModerationProvider(apiKey, nil); provider != nil {
		return provider
	}
	return nil
}

// OpenAIModerationProvider is a request-scoped proxy for the official OpenAI
// Moderations JSON API. It sends {model,input}, reads only results[0].flagged,
// and drops all plaintext and raw response references before returning.
type OpenAIModerationProvider struct {
	apiKey   string
	endpoint string
	client   *http.Client
}

func NewOpenAIModerationProvider(apiKey string, client *http.Client) *OpenAIModerationProvider {
	if strings.TrimSpace(apiKey) == "" {
		return nil
	}
	if client == nil {
		client = &http.Client{Timeout: moderationTimeout}
	}
	return &OpenAIModerationProvider{
		apiKey:   strings.TrimSpace(apiKey),
		endpoint: "https://api.openai.com/v1/moderations",
		client:   client,
	}
}

func (p *OpenAIModerationProvider) Moderate(ctx context.Context, plaintext string) (ModerationDecision, error) {
	if p == nil || p.client == nil || p.apiKey == "" {
		return ModerationUnavailable, ErrModerationUnavailable
	}

	// The request body is the only server-side plaintext copy. It is zeroed as
	// soon as the synchronous upstream request returns; no DB, queue, or log
	// receives either plaintext or the provider response.
	body, err := json.Marshal(struct {
		Model string `json:"model"`
		Input string `json:"input"`
	}{Model: moderationModel, Input: plaintext})
	plaintext = ""
	if err != nil {
		return ModerationUnavailable, err
	}
	defer clear(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return ModerationUnavailable, err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")

	response, err := p.client.Do(req)
	if err != nil {
		return ModerationUnavailable, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxModerationResponse))
		return ModerationUnavailable, ErrModerationUnavailable
	}

	var payload struct {
		Results []struct {
			Flagged bool `json:"flagged"`
		} `json:"results"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxModerationResponse))
	if err := decoder.Decode(&payload); err != nil || len(payload.Results) != 1 {
		return ModerationUnavailable, ErrModerationUnavailable
	}
	if payload.Results[0].Flagged {
		return ModerationBlocked, nil
	}
	return ModerationAllowed, nil
}

// DevelopmentModerationProvider is a deterministic, local-only safety guard
// for short-lived development testing when an OpenAI key is intentionally not
// configured. It is not a replacement for the production provider: it blocks
// only high-confidence patterns and never sends plaintext over the network.
type DevelopmentModerationProvider struct{}

var developmentModerationBlockPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(?:\b(?:line|instagram|insta|whatsapp|telegram|signal|tel|phone|paypal|crypto|bitcoin)\b|電話|連絡先|@\w+)`),
	regexp.MustCompile(`(?:\+?\d[\d\s-]{8,}\d)`),
	regexp.MustCompile(`(?i)(?:住所|自宅|家に来て|個室|人気のない|暗い場所|パスポート|身分証|カード番号|クレジットカード|\baddress\b|\bpassport\b|\bcredit card\b)`),
	regexp.MustCompile(`(?i)(?:死ね|ばか|差別|\bhate\b|\bidiot\b|\bstupid\b|\bracist\b|\bsex\b|\bsexual\b|ホテル|\bhotel\b|裸|送金|投資|振込|\bmoney\b|\bcrypto\b|bitcoin|断るな|来ないと困る|絶対来て|\bmust come\b|\bdon't cancel\b|\bdo not cancel\b)`),
}

func NewDevelopmentModerationProvider() *DevelopmentModerationProvider {
	return &DevelopmentModerationProvider{}
}

func (p *DevelopmentModerationProvider) Moderate(ctx context.Context, plaintext string) (ModerationDecision, error) {
	if p == nil {
		return ModerationUnavailable, ErrModerationUnavailable
	}
	select {
	case <-ctx.Done():
		return ModerationUnavailable, ctx.Err()
	default:
	}
	if strings.TrimSpace(plaintext) == "" {
		return ModerationUnavailable, ErrModerationUnavailable
	}

	normalized := strings.ToLower(plaintext)
	plaintext = ""
	for _, pattern := range developmentModerationBlockPatterns {
		if pattern.MatchString(normalized) {
			normalized = ""
			return ModerationBlocked, nil
		}
	}
	normalized = ""
	return ModerationAllowed, nil
}

package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
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

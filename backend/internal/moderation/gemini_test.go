package moderation

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func geminiStub(t *testing.T, payload string) *Service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":` + payload + `}]}}]}`))
	}))
	t.Cleanup(server.Close)
	return NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
}

func TestInspectCleanMessage(t *testing.T) {
	service := geminiStub(t, `"{\"categories\":[],\"severity\":\"none\"}"`)
	result, err := service.Inspect(context.Background(), "user-1", "Let's meet at the station at noon.")
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	if result.Flagged() || len(result.Categories) != 0 || result.Severity != "none" {
		t.Fatalf("Inspect() = %#v, want clean", result)
	}
}

func TestInspectForcesBlockForContactSharing(t *testing.T) {
	service := geminiStub(t, `"{\"categories\":[\"external_contact\"],\"severity\":\"warn\"}"`)
	result, err := service.Inspect(context.Background(), "user-1", "add me on LINE: taro123")
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	if result.Severity != "block" || !result.Flagged() {
		t.Fatalf("Inspect() = %#v, want severity block", result)
	}
}

func TestInspectWarnForNonBlockingCategory(t *testing.T) {
	service := geminiStub(t, `"{\"categories\":[\"money\"],\"severity\":\"none\"}"`)
	result, err := service.Inspect(context.Background(), "user-1", "pay me a tip first")
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	if result.Severity != "warn" {
		t.Fatalf("Inspect() severity = %q, want warn", result.Severity)
	}
}

func TestInspectRejectsUnknownCategory(t *testing.T) {
	service := geminiStub(t, `"{\"categories\":[\"weapons\"],\"severity\":\"block\"}"`)
	if _, err := service.Inspect(context.Background(), "user-1", "text"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("Inspect() error = %v, want ErrUpstream", err)
	}
}

func TestInspectRejectsEmptyText(t *testing.T) {
	service := NewGeminiWithClient("test-key", DefaultModel, "https://example.invalid", http.DefaultClient)
	if _, err := service.Inspect(context.Background(), "user-1", "   "); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Inspect() error = %v, want ErrInvalidInput", err)
	}
}

func TestInspectRateLimitsPerUser(t *testing.T) {
	service := geminiStub(t, `"{\"categories\":[],\"severity\":\"none\"}"`)
	if _, err := service.Inspect(context.Background(), "user-1", "hello"); err != nil {
		t.Fatalf("first Inspect() error = %v", err)
	}
	if _, err := service.Inspect(context.Background(), "user-1", "hello again"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("second Inspect() error = %v, want ErrRateLimited", err)
	}
}

func TestPlaceholderKeyIsUnavailable(t *testing.T) {
	if NewGemini(PlaceholderAPIKey, DefaultModel).Available() {
		t.Fatal("placeholder Gemini key must not enable moderation")
	}
}

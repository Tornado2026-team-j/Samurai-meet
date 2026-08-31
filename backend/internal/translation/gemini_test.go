package translation

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiTranslateReturnsModelText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Query().Get("key") != "test-key" {
			t.Fatalf("request = %s %s", r.Method, r.URL.String())
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "into English") {
			t.Fatalf("target language missing from prompt: %s", body)
		}
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"Let's meet at the ticket gate.\n"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
	got, err := service.Translate(context.Background(), "user-1", "改札で待ち合わせしましょう。", "EN")
	if err != nil {
		t.Fatalf("Translate() error = %v", err)
	}
	if got != "Let's meet at the ticket gate." {
		t.Fatalf("Translate() = %q", got)
	}
}

func TestGeminiTranslateRejectsUnsupportedTargetAndEmptyText(t *testing.T) {
	service := NewGeminiWithClient("test-key", DefaultModel, "https://example.invalid", http.DefaultClient)
	if _, err := service.Translate(context.Background(), "user-1", "hello", "de"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unsupported target error = %v, want ErrInvalidInput", err)
	}
	if _, err := service.Translate(context.Background(), "user-1", "   ", "ja"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty text error = %v, want ErrInvalidInput", err)
	}
}

func TestGeminiTranslateRateLimitsPerUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
	if _, err := service.Translate(context.Background(), "user-1", "やあ", "en"); err != nil {
		t.Fatalf("first Translate() error = %v", err)
	}
	if _, err := service.Translate(context.Background(), "user-1", "やあ", "en"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("second Translate() error = %v, want ErrRateLimited", err)
	}
}

func TestGeminiTranslatePlaceholderKeyIsUnavailable(t *testing.T) {
	if NewGemini(PlaceholderAPIKey, DefaultModel).Available() {
		t.Fatal("placeholder Gemini key must not enable translation")
	}
}

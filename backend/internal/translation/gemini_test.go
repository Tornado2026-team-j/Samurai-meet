package translation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiTranslateDetectsLanguageAndReturnsStrictResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/models/test-model:generateContent" || r.URL.Query().Get("key") != "" || r.Header.Get("x-goog-api-key") != "test-key" {
			t.Fatalf("request = %s %s", r.Method, r.URL.String())
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request: %v", err)
		}
		if !strings.Contains(string(body), "Target language: ja") || !strings.Contains(string(body), "Hello from Kyoto") {
			t.Fatalf("translation request does not contain the scoped input: %s", body)
		}
		var requestBody struct {
			GenerationConfig struct {
				ResponseMIMEType string `json:"responseMimeType"`
				ResponseSchema   struct {
					Required []string `json:"required"`
				} `json:"responseSchema"`
				Temperature float64 `json:"temperature"`
			} `json:"generationConfig"`
		}
		if err := json.Unmarshal(body, &requestBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if requestBody.GenerationConfig.ResponseMIMEType != "application/json" || requestBody.GenerationConfig.Temperature != 0 {
			t.Fatalf("generation config = %#v", requestBody.GenerationConfig)
		}
		if got := requestBody.GenerationConfig.ResponseSchema.Required; len(got) != 2 || got[0] != "source_language" || got[1] != "translation" {
			t.Fatalf("required fields = %#v", got)
		}
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"source_language\":\"en\",\"translation\":\"京都からこんにちは\"}"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", "test-model", server.URL, server.Client())
	result, err := service.Translate(context.Background(), "user-1", "Hello from Kyoto", "ja")
	if err != nil {
		t.Fatalf("Translate() error = %v", err)
	}
	if result.SourceLanguage != "en" || result.Translation != "京都からこんにちは" {
		t.Fatalf("Translate() = %#v", result)
	}
}

func TestGeminiTranslateRejectsInvalidModelOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"source_language\":\"en\",\"translation\":\"ok\"} extra"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
	if _, err := service.Translate(context.Background(), "user-1", "hello", "ja"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("Translate() error = %v, want ErrUpstream", err)
	}
}

func TestGeminiTranslateDistinguishesProviderFailures(t *testing.T) {
	for _, test := range []struct {
		name string
		code int
		want error
	}{
		{name: "rate limited", code: http.StatusTooManyRequests, want: ErrProviderRateLimited},
		{name: "unauthorized", code: http.StatusUnauthorized, want: ErrProviderUnavailable},
		{name: "forbidden", code: http.StatusForbidden, want: ErrProviderUnavailable},
		{name: "other upstream failure", code: http.StatusBadGateway, want: ErrUpstream},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.code)
				_, _ = w.Write([]byte(`{"error":"provider detail must stay server-side"}`))
			}))
			defer server.Close()

			service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
			if _, err := service.Translate(context.Background(), "user-1", "hello", "ja"); !errors.Is(err, test.want) {
				t.Fatalf("Translate() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestGeminiTranslateValidatesInputAndPlaceholder(t *testing.T) {
	service := NewGemini(PlaceholderAPIKey, DefaultModel)
	if service.Available() {
		t.Fatal("placeholder Gemini key must not enable translation")
	}
	for _, test := range []struct {
		name   string
		text   string
		target string
		want   error
	}{
		{name: "empty text", text: "", target: "ja", want: ErrInvalidInput},
		{name: "unsupported language", text: "hello", target: "fr", want: ErrInvalidInput},
		{name: "missing user", text: "hello", target: "ja", want: ErrInvalidInput},
	} {
		t.Run(test.name, func(t *testing.T) {
			userID := "user-1"
			if test.name == "missing user" {
				userID = ""
			}
			if _, err := service.Translate(context.Background(), userID, test.text, test.target); !errors.Is(err, test.want) {
				t.Fatalf("Translate() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestParseTranslationJSONRejectsUnknownFieldsAndControls(t *testing.T) {
	if _, err := parseTranslationJSON(`{"source_language":"en","translation":"ok","extra":true}`); err == nil {
		t.Fatal("unknown field should be rejected")
	}
	if _, err := parseTranslationJSON(`{"source_language":"en","translation":"line\u0001break"}`); err == nil {
		t.Fatal("control character should be rejected")
	}
}

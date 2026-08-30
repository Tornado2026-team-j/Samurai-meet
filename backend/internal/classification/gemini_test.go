package classification

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiClassifyAcceptsOnlySupportedCategory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Query().Get("key") != "test-key" {
			t.Fatalf("request = %s %s", r.Method, r.URL.String())
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "Food, Places, Activity, or Other") {
			t.Fatalf("classification contract missing from request: %s", body)
		}
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"Places"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
	category, err := service.Classify(context.Background(), "user-1", "Please show me a temple.")
	if err != nil || category != "Places" {
		t.Fatalf("Classify() = %q, %v", category, err)
	}
}

func TestGeminiClassifyRejectsUnexpectedModelOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"Culture"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
	if _, err := service.Classify(context.Background(), "user-1", "Please show me a temple."); !errors.Is(err, ErrUpstream) {
		t.Fatalf("Classify() error = %v, want ErrUpstream", err)
	}
}

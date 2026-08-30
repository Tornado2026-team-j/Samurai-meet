package safety

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIModerationProviderSendsOnlyEvidence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("authorization = %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		text := string(body)
		if !strings.Contains(text, "danger evidence") || strings.Contains(text, "user-123") || strings.Contains(text, "access-token") {
			t.Fatalf("unexpected provider payload: %s", text)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"omni-moderation-latest","results":[{"flagged":true,"categories":{"violence":true}}]}`))
	}))
	defer server.Close()
	provider := NewOpenAIModerationProvider("test-key", server.Client())
	provider.endpoint = server.URL
	result, err := provider.Triage(context.Background(), TriageRequest{Evidence: "danger evidence", Language: "ja"})
	if err != nil {
		t.Fatal(err)
	}
	if result.RiskLevel != TriageHigh || result.RiskKind != "violence" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestOpenAIModerationProviderRejectsContractViolation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer server.Close()
	provider := NewOpenAIModerationProvider("key", server.Client())
	provider.endpoint = server.URL
	if _, err := provider.Triage(context.Background(), TriageRequest{Evidence: "evidence"}); err == nil {
		t.Fatal("contract violation should fail closed")
	}
}

func TestGeminiTriageProviderRejectsContractViolation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || strings.Contains(r.RequestURI, "key=") {
			t.Fatalf("Gemini API key must not be in URL: %q", r.RequestURI)
		}
		if got := r.Header.Get("x-goog-api-key"); got != "key" {
			t.Fatalf("x-goog-api-key = %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), "evidence") || strings.Contains(string(body), "access-token") {
			t.Fatalf("unexpected Gemini payload: %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"risk_level\":\"high\",\"risk_kind\":\"unknown\"}"}]}}]}`))
	}))
	defer server.Close()
	provider := NewGeminiTriageProvider("key", server.Client())
	provider.endpoint = server.URL
	if _, err := provider.Triage(context.Background(), TriageRequest{Evidence: "evidence"}); err == nil {
		t.Fatal("invalid enum should fail closed")
	}
}

func TestTriageInputValidation(t *testing.T) {
	if NewOpenAIModerationProvider("", nil) != nil || NewGeminiTriageProvider("", nil) != nil {
		t.Fatal("empty API keys must not enable a provider")
	}
	if normalizeLanguage("ja-JP") != "ja-jp" || normalizeLanguage("ja_JP") != "" {
		t.Fatal("language normalization mismatch")
	}
	if level, kind := strongestResult([]TriageResult{{RiskLevel: TriageLow, RiskKind: "harassment"}, {RiskLevel: TriageHigh, RiskKind: "scam"}}); level != TriageHigh || kind != "scam" {
		t.Fatalf("strongest result = %s/%s", level, kind)
	}
}

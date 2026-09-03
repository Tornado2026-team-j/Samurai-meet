package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOpenAIModerationProviderUsesOfficialContractAndReturnsOnlyDecision(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("unexpected moderation request: method=%s authorization=%q", r.Method, r.Header.Get("Authorization"))
		}
		var input struct {
			Model string `json:"model"`
			Input string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input.Model != moderationModel || input.Input != "unsafe example" {
			t.Fatalf("unexpected moderation body: %#v", input)
		}
		_, _ = w.Write([]byte(`{"model":"omni-moderation-latest","results":[{"flagged":true,"categories":{"violence":true},"category_scores":{"violence":0.99}}]}`))
	}))
	defer server.Close()

	provider := NewOpenAIModerationProvider("test-key", server.Client())
	provider.endpoint = server.URL
	decision, err := provider.Moderate(context.Background(), "unsafe example")
	if err != nil || decision != ModerationBlocked {
		t.Fatalf("decision=%q err=%v, want blocked without provider details", decision, err)
	}
}

func TestOpenAIModerationProviderMapsTimeoutToUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Outrun the client's bounded request, then complete so httptest.Server
		// teardown cannot wait on a cancelled request context.
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusGatewayTimeout)
	}))
	defer server.Close()

	provider := NewOpenAIModerationProvider("test-key", &http.Client{Timeout: 20 * time.Millisecond})
	provider.endpoint = server.URL
	decision, err := provider.Moderate(context.Background(), "message")
	if decision != ModerationUnavailable || err == nil {
		t.Fatalf("decision=%q err=%v, want unavailable timeout", decision, err)
	}
}

func TestOpenAIModerationProviderWithoutKeyIsUnavailable(t *testing.T) {
	if NewOpenAIModerationProvider("", nil) != nil {
		t.Fatal("provider must not be constructed without an API key")
	}
}

func TestNewModerationProviderUsesDevelopmentFreeModeOnlyWhenExplicitlyEnabled(t *testing.T) {
	if provider := NewModerationProvider("", false); provider != nil {
		t.Fatal("free mode must require explicit opt-in")
	}
	if provider := NewModerationProvider("", true); provider == nil {
		t.Fatal("explicit free mode should construct a local provider")
	}
	if provider := NewModerationProvider("test-key", true); provider == nil {
		t.Fatal("explicit free mode should construct a local provider even when an inherited key exists")
	} else if _, ok := provider.(*DevelopmentModerationProvider); !ok {
		t.Fatalf("free mode provider type = %T, want development provider", provider)
	}
	if provider := NewModerationProvider("test-key", false); provider == nil {
		t.Fatal("configured OpenAI provider should be selected when free mode is disabled")
	} else if _, ok := provider.(*OpenAIModerationProvider); !ok {
		t.Fatalf("configured provider type = %T, want OpenAI provider", provider)
	}
}

func TestDevelopmentModerationProviderAllowsSafeTextAndBlocksHighConfidencePatterns(t *testing.T) {
	provider := NewDevelopmentModerationProvider()
	decision, err := provider.Moderate(context.Background(), "集合場所はどこですか？")
	if err != nil || decision != ModerationAllowed {
		t.Fatalf("safe text decision=%q err=%v, want allowed", decision, err)
	}
	decision, err = provider.Moderate(context.Background(), "電話番号は090-1234-5678です")
	if err != nil || decision != ModerationBlocked {
		t.Fatalf("contact text decision=%q err=%v, want blocked", decision, err)
	}
}

func TestDevelopmentModerationProviderHonorsCancellationAndRejectsEmptyText(t *testing.T) {
	provider := NewDevelopmentModerationProvider()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	decision, err := provider.Moderate(ctx, "message")
	if decision != ModerationUnavailable || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled decision=%q err=%v, want unavailable/context canceled", decision, err)
	}
	decision, err = provider.Moderate(context.Background(), "   ")
	if decision != ModerationUnavailable || !errors.Is(err, ErrModerationUnavailable) {
		t.Fatalf("empty decision=%q err=%v, want unavailable", decision, err)
	}
}

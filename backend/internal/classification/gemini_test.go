package classification

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

func TestGeminiClassifyAcceptsOnlySupportedCategory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Query().Get("key") != "test-key" {
			t.Fatalf("request = %s %s", r.Method, r.URL.String())
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "Food, Heritage, Activity, or Other") {
			t.Fatalf("classification contract missing from request: %s", body)
		}
		var requestBody struct {
			GenerationConfig struct {
				ResponseMIMEType string `json:"responseMimeType"`
				ResponseSchema   struct {
					Required []string `json:"required"`
				} `json:"responseSchema"`
			} `json:"generationConfig"`
		}
		if err := json.Unmarshal(body, &requestBody); err != nil {
			t.Fatalf("decode classification request: %v", err)
		}
		if requestBody.GenerationConfig.ResponseMIMEType != "application/json" {
			t.Fatalf("responseMimeType = %q, want application/json", requestBody.GenerationConfig.ResponseMIMEType)
		}
		if got := requestBody.GenerationConfig.ResponseSchema.Required; len(got) != 2 || got[0] != "category" || got[1] != "keywords" {
			t.Fatalf("required fields = %#v, want category and keywords", got)
		}
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"category\":\"Heritage\",\"keywords\":[\"temple\",\"sightseeing\"]}"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())

	result, err := service.ClassifyWithKeywords(context.Background(), "user-1", "Please show me a temple.")
	if err != nil {
		t.Fatalf("ClassifyWithKeywords() error = %v", err)
	}
	if result.Category != "Heritage" || len(result.Keywords) != 2 || result.Keywords[0] != "temple" || result.Keywords[1] != "sightseeing" {
		t.Fatalf("ClassifyWithKeywords() = %#v, want Heritage with temple and sightseeing", result)
	}
}

func TestGeminiClassifyRejectsUnexpectedModelOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"category\":\"Culture\",\"keywords\":[\"temple\"]}"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiWithClient("test-key", DefaultModel, server.URL, server.Client())
	if _, err := service.Classify(context.Background(), "user-1", "Please show me a temple."); !errors.Is(err, ErrUpstream) {
		t.Fatalf("Classify() error = %v, want ErrUpstream", err)
	}
}

func TestGeminiPlaceholderKeyIsUnavailable(t *testing.T) {
	service := NewGemini(PlaceholderAPIKey, DefaultModel)
	if service.Available() {
		t.Fatal("placeholder Gemini key must not enable classification")
	}
}

func TestParseClassificationJSON(t *testing.T) {
	longKeyword := strings.Repeat("あ", maxClassificationKeywordRunes+1)
	tests := []struct {
		name      string
		text      string
		want      ClassificationResult
		wantError bool
	}{
		{
			name: "normal strict JSON",
			text: `{"category":"Heritage","keywords":["temple"," sightseeing "]}`,
			want: ClassificationResult{Category: "Heritage", Keywords: []string{"temple", "sightseeing"}},
		},
		{
			name:      "unknown field",
			text:      `{"category":"Food","keywords":["ramen"],"explanation":"extra"}`,
			wantError: true,
		},
		{
			name:      "trailing data",
			text:      `{"category":"Food","keywords":["ramen"]}{"extra":true}`,
			wantError: true,
		},
		{
			name:      "unsupported category",
			text:      `{"category":"Culture","keywords":["temple"]}`,
			wantError: true,
		},
		{
			name: "empty keywords use safe fallback",
			text: `{"category":"Activity","keywords":[]}`,
			want: ClassificationResult{Category: "Activity", Keywords: []string{"Experience"}},
		},
		{
			name: "duplicate keywords are normalized",
			text: `{"category":"Food","keywords":["Ramen"," ramen ","RAMEN","restaurant"]}`,
			want: ClassificationResult{Category: "Food", Keywords: []string{"Ramen", "restaurant"}},
		},
		{
			name:      "keyword too long",
			text:      `{"category":"Other","keywords":["` + longKeyword + `"]}`,
			wantError: true,
		},
		{
			name:      "keyword contains control character",
			text:      `{"category":"Other","keywords":["line\nbreak"]}`,
			wantError: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseClassificationJSON(test.text)
			if test.wantError {
				if err == nil {
					t.Fatalf("parseClassificationJSON() error = nil, want an error; result = %#v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseClassificationJSON() error = %v", err)
			}
			if got.Category != test.want.Category || len(got.Keywords) != len(test.want.Keywords) {
				t.Fatalf("parseClassificationJSON() = %#v, want %#v", got, test.want)
			}
			for i := range test.want.Keywords {
				if got.Keywords[i] != test.want.Keywords[i] {
					t.Fatalf("keyword[%d] = %q, want %q; result = %#v", i, got.Keywords[i], test.want.Keywords[i], got)
				}
			}
		})
	}
}

package memorymonster

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiImageGeneratorSendsMemoryInputs(t *testing.T) {
	var seen struct {
		Model string `json:"model"`
		Input []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			MIMEType string `json:"mime_type"`
			Data     string `json:"data"`
		} `json:"input"`
		ResponseFormat struct {
			Type        string `json:"type"`
			MIMEType    string `json:"mime_type"`
			AspectRatio string `json:"aspect_ratio"`
			ImageSize   string `json:"image_size"`
		} `json:"response_format"`
		Store bool `json:"store"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if got := r.Header.Get("x-goog-api-key"); got != "test-key" {
			t.Fatalf("x-goog-api-key = %q", got)
		}
		if got := r.URL.Path; got != "/" {
			t.Fatalf("path = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"completed","output_image":{"type":"image","mime_type":"image/jpeg","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="}}`))
	}))
	defer server.Close()

	generator := &GeminiImageGenerator{
		apiKey:   "test-key",
		model:    "gemini-3.1-flash-lite-image",
		endpoint: server.URL,
		client:   server.Client(),
	}
	image, err := generator.Generate(context.Background(), GenerateInput{
		UserID:           "user-1",
		Photo:            []byte("fake-image-bytes"),
		PhotoContentType: "image/jpeg",
		MemorableObject:  "赤い提灯",
		MemoryText:       "一緒に抹茶を飲んだ",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if image.ContentType != "image/jpeg" || image.Provider != "gemini:gemini-3.1-flash-lite-image" || len(image.Bytes) == 0 {
		t.Fatalf("generated image = %#v", image)
	}
	if seen.Model != "gemini-3.1-flash-lite-image" || seen.Store {
		t.Fatalf("request metadata = %#v", seen)
	}
	if len(seen.Input) != 2 || seen.Input[0].Type != "text" || seen.Input[1].Type != "image" {
		t.Fatalf("input = %#v", seen.Input)
	}
	prompt := seen.Input[0].Text
	if seen.Input[1].MIMEType != "image/jpeg" || seen.Input[1].Data == "" {
		t.Fatalf("image input = %#v", seen.Input[1])
	}
	if seen.ResponseFormat.Type != "image" || seen.ResponseFormat.MIMEType != "image/jpeg" || seen.ResponseFormat.AspectRatio != "1:1" || seen.ResponseFormat.ImageSize != "1K" {
		t.Fatalf("response format = %#v", seen.ResponseFormat)
	}
	for _, want := range []string{"赤い提灯", "一緒に抹茶を飲んだ", "no text", "no logo"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt %q does not contain %q", prompt, want)
		}
	}
}

func TestGeminiImageGeneratorReadsImageFromOutputStep(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"completed","steps":[{"type":"model_output","content":[{"type":"image","mime_type":"image/jpeg","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="}]}]}`))
	}))
	defer server.Close()

	generator := &GeminiImageGenerator{apiKey: "test-key", model: "models/gemini-3.1-flash-lite-image", endpoint: server.URL, client: server.Client()}
	image, err := generator.Generate(context.Background(), GenerateInput{
		UserID:           "user-1",
		Photo:            []byte("fake-image-bytes"),
		PhotoContentType: "image/png",
		MemorableObject:  "桜",
		MemoryText:       "道で話した",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if image.ContentType != "image/jpeg" || image.Provider != "gemini:gemini-3.1-flash-lite-image" || len(image.Bytes) == 0 {
		t.Fatalf("generated image = %#v", image)
	}
}

func TestPlaceholderGeneratorRequiresAllInputs(t *testing.T) {
	if _, err := (PlaceholderGenerator{}).Generate(context.Background(), GenerateInput{}); err != ErrInvalidInput {
		t.Fatalf("Generate() error = %v, want ErrInvalidInput", err)
	}
}

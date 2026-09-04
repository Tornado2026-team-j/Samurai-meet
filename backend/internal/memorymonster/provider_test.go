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
	requests := make([]struct {
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
	}, 0, 2)
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
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		requests = append(requests, seen)
		w.Header().Set("Content-Type", "application/json")
		if len(requests) == 1 {
			_, _ = w.Write([]byte(`{"status":"completed","steps":[{"type":"model_output","content":[{"type":"text","text":"Two people are standing side by side with relaxed arms and a slight forward-facing pose."}]}]}`))
			return
		}
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
	if len(requests) != 2 {
		t.Fatalf("request count = %d, want 2", len(requests))
	}
	poseRequest := requests[0]
	if poseRequest.Model != "gemini-3.1-flash-lite-image" || poseRequest.Store {
		t.Fatalf("pose request metadata = %#v", poseRequest)
	}
	if len(poseRequest.Input) != 2 || poseRequest.Input[0].Type != "text" || poseRequest.Input[1].Type != "image" {
		t.Fatalf("pose input = %#v", poseRequest.Input)
	}
	if !strings.Contains(poseRequest.Input[0].Text, "describe only the human pose") {
		t.Fatalf("pose prompt = %q", poseRequest.Input[0].Text)
	}
	if poseRequest.Input[1].MIMEType != "image/jpeg" || poseRequest.Input[1].Data == "" {
		t.Fatalf("pose image input = %#v", poseRequest.Input[1])
	}
	imageRequest := requests[1]
	if len(imageRequest.Input) != 1 || imageRequest.Input[0].Type != "text" {
		t.Fatalf("image input = %#v", imageRequest.Input)
	}
	prompt := imageRequest.Input[0].Text
	if strings.Contains(prompt, "fake-image-bytes") || strings.Contains(prompt, "base64") {
		t.Fatalf("image prompt should not include raw photo data: %q", prompt)
	}
	if !strings.Contains(prompt, "- Photo: Two people are standing side by side") {
		t.Fatalf("image prompt does not include pose text: %q", prompt)
	}
	if imageRequest.ResponseFormat.Type != "image" || imageRequest.ResponseFormat.MIMEType != "image/jpeg" || imageRequest.ResponseFormat.AspectRatio != "1:1" || imageRequest.ResponseFormat.ImageSize != "1K" {
		t.Fatalf("response format = %#v", imageRequest.ResponseFormat)
	}
	for _, want := range []string{"赤い提灯", "一緒に抹茶を飲んだ", "exactly two arms", "solid pure white background", "no text", "no logo"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt %q does not contain %q", prompt, want)
		}
	}
}

func TestGeminiImageGeneratorReadsImageFromOutputStep(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		if requestCount == 1 {
			_, _ = w.Write([]byte(`{"status":"completed","output_text":"One person is sitting upright with both hands close to the body."}`))
			return
		}
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

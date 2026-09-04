package memorymonster

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const PromptVersion = "memory-monster-v1"

type GenerateInput struct {
	UserID           string
	Photo            []byte
	PhotoContentType string
	MemorableObject  string
	MemoryText       string
}

type GeneratedImage struct {
	Bytes       []byte
	ContentType string
	Provider    string
}

type Generator interface {
	Generate(ctx context.Context, input GenerateInput) (GeneratedImage, error)
}

type GeminiImageGenerator struct {
	apiKey   string
	model    string
	endpoint string
	client   *http.Client
}

func NewGeminiImageGenerator(apiKey, model string) *GeminiImageGenerator {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = "gemini-3.1-flash-lite-image"
	}
	return &GeminiImageGenerator{
		apiKey:   apiKey,
		model:    model,
		endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
		client:   &http.Client{Timeout: 45 * time.Second},
	}
}

func (g *GeminiImageGenerator) Generate(ctx context.Context, input GenerateInput) (GeneratedImage, error) {
	if g == nil || strings.TrimSpace(g.apiKey) == "" {
		return GeneratedImage{}, ErrGenerationUnavailable
	}
	model := strings.TrimPrefix(strings.TrimSpace(g.model), "models/")
	requestPayload := geminiInteractionRequest{
		Model: model,
		Input: []geminiInteractionContent{
			{
				Type: "text",
				Text: buildPrompt(input),
			},
			{
				Type:     "image",
				MIMEType: input.PhotoContentType,
				Data:     base64.StdEncoding.EncodeToString(input.Photo),
			},
		},
		ResponseFormat: geminiImageResponseFormat{
			Type:        "image",
			MIMEType:    "image/jpeg",
			AspectRatio: "1:1",
			ImageSize:   "1K",
		},
		Store: false,
	}
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return GeneratedImage{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.endpoint, bytes.NewReader(body))
	if err != nil {
		return GeneratedImage{}, err
	}
	req.Header.Set("x-goog-api-key", g.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := g.client.Do(req)
	if err != nil {
		return GeneratedImage{}, err
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(res.Body, 16*1024*1024))
	if err != nil {
		return GeneratedImage{}, err
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return GeneratedImage{}, ErrGenerationUnavailable
	}
	if res.StatusCode == http.StatusTooManyRequests {
		return GeneratedImage{}, ErrGenerationRateLimited
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return GeneratedImage{}, fmt.Errorf("%w: status %d", ErrGenerationFailed, res.StatusCode)
	}
	var responsePayload geminiInteractionResponse
	if err := json.Unmarshal(responseBody, &responsePayload); err != nil {
		return GeneratedImage{}, fmt.Errorf("%w: invalid provider response", ErrGenerationFailed)
	}
	if image, ok, err := decodeInteractionImage(responsePayload.OutputImage, model); ok || err != nil {
		return image, err
	}
	for _, step := range responsePayload.Steps {
		if step.Type != "" && step.Type != "model_output" {
			continue
		}
		for _, content := range step.Content {
			if content.Type != "image" || strings.TrimSpace(content.Data) == "" {
				continue
			}
			if image, ok, err := decodeInteractionImage(&content, model); ok || err != nil {
				return image, err
			}
		}
	}
	if len(responsePayload.Errors) > 0 {
		return GeneratedImage{}, fmt.Errorf("%w: %s", ErrGenerationFailed, responsePayload.Errors[0].Message)
	}
	return GeneratedImage{}, fmt.Errorf("%w: provider returned no image", ErrGenerationFailed)
}

func decodeInteractionImage(content *geminiInteractionContent, model string) (GeneratedImage, bool, error) {
	if content == nil || strings.TrimSpace(content.Data) == "" {
		return GeneratedImage{}, false, nil
	}
	image, err := base64.StdEncoding.DecodeString(content.Data)
	if err != nil {
		return GeneratedImage{}, true, fmt.Errorf("%w: invalid generated image", ErrGenerationFailed)
	}
	contentType := strings.TrimSpace(content.MIMEType)
	if contentType == "" {
		contentType = "image/jpeg"
	}
	return GeneratedImage{Bytes: image, ContentType: contentType, Provider: "gemini:" + model}, true, nil
}

type geminiInteractionRequest struct {
	Model          string                     `json:"model"`
	Input          []geminiInteractionContent `json:"input"`
	ResponseFormat geminiImageResponseFormat  `json:"response_format"`
	Store          bool                       `json:"store"`
}

type geminiInteractionContent struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	MIMEType string `json:"mime_type,omitempty"`
	Data     string `json:"data,omitempty"`
}

type geminiImageResponseFormat struct {
	Type        string `json:"type"`
	MIMEType    string `json:"mime_type"`
	AspectRatio string `json:"aspect_ratio"`
	ImageSize   string `json:"image_size"`
}

type geminiInteractionResponse struct {
	OutputImage *geminiInteractionContent `json:"output_image"`
	Steps       []struct {
		Type    string                     `json:"type"`
		Content []geminiInteractionContent `json:"content"`
	} `json:"steps"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type PlaceholderGenerator struct{}

func (PlaceholderGenerator) Generate(_ context.Context, input GenerateInput) (GeneratedImage, error) {
	if strings.TrimSpace(input.MemorableObject) == "" || strings.TrimSpace(input.MemoryText) == "" || len(input.Photo) == 0 {
		return GeneratedImage{}, ErrInvalidInput
	}
	return GeneratedImage{
		Bytes:       placeholderPNG,
		ContentType: "image/png",
		Provider:    "placeholder",
	}, nil
}

func buildPrompt(input GenerateInput) string {
	return strings.Join([]string{
		"Create one cute original mascot monster illustration for Samurai Meet.",
		"Use the attached photo only as reference for the people's friendly mood, clothing colors, and broad visual atmosphere. Do not make a realistic portrait.",
		"The monster motif must clearly be: " + strings.TrimSpace(input.MemorableObject),
		"Decorate the character with the memory: " + strings.TrimSpace(input.MemoryText),
		"Style: bright Japanese mobile app collectible, clean outline, soft shading, full body, square composition, no text, no logo, no watermark.",
	}, "\n")
}

var (
	ErrGenerationUnavailable = errors.New("memory monster generation unavailable")
	ErrGenerationRateLimited = errors.New("memory monster generation rate limited")
	ErrGenerationFailed      = errors.New("memory monster generation failed")
)

var placeholderPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
	0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
	0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78,
	0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99,
	0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

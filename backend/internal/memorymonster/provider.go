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
	poseDescription, err := g.extractPhotoPose(ctx, input, model)
	if err != nil {
		return GeneratedImage{}, err
	}
	requestPayload := geminiInteractionRequest{
		Model: model,
		Input: []geminiInteractionContent{
			{
				Type: "text",
				Text: buildPrompt(input, poseDescription),
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
	responsePayload, err := g.doInteraction(ctx, requestPayload)
	if err != nil {
		return GeneratedImage{}, err
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

func (g *GeminiImageGenerator) extractPhotoPose(ctx context.Context, input GenerateInput, model string) (string, error) {
	requestPayload := geminiInteractionRequest{
		Model: model,
		Input: []geminiInteractionContent{
			{
				Type: "text",
				Text: poseExtractionPrompt(),
			},
			{
				Type:     "image",
				MIMEType: input.PhotoContentType,
				Data:     base64.StdEncoding.EncodeToString(input.Photo),
			},
		},
		ResponseFormat: geminiTextResponseFormat{
			Type:     "text",
			MIMEType: "text/plain",
		},
		GenerationConfig: &geminiGenerationConfig{
			MaxOutputTokens: 80,
			ThinkingLevel:   "minimal",
		},
		Store: false,
	}
	responsePayload, err := g.doInteraction(ctx, requestPayload)
	if err != nil {
		return "", err
	}
	text := normalizePoseDescription(extractInteractionText(responsePayload))
	if text == "" {
		return "", fmt.Errorf("%w: empty pose description", ErrGenerationFailed)
	}
	return text, nil
}

func (g *GeminiImageGenerator) doInteraction(ctx context.Context, requestPayload geminiInteractionRequest) (geminiInteractionResponse, error) {
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return geminiInteractionResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.endpoint, bytes.NewReader(body))
	if err != nil {
		return geminiInteractionResponse{}, err
	}
	req.Header.Set("x-goog-api-key", g.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := g.client.Do(req)
	if err != nil {
		return geminiInteractionResponse{}, err
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(res.Body, 16*1024*1024))
	if err != nil {
		return geminiInteractionResponse{}, err
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return geminiInteractionResponse{}, ErrGenerationUnavailable
	}
	if res.StatusCode == http.StatusTooManyRequests {
		return geminiInteractionResponse{}, ErrGenerationRateLimited
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return geminiInteractionResponse{}, fmt.Errorf("%w: status %d", ErrGenerationFailed, res.StatusCode)
	}
	var responsePayload geminiInteractionResponse
	if err := json.Unmarshal(responseBody, &responsePayload); err != nil {
		return geminiInteractionResponse{}, fmt.Errorf("%w: invalid provider response", ErrGenerationFailed)
	}
	return responsePayload, nil
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
	Model            string                     `json:"model"`
	Input            []geminiInteractionContent `json:"input"`
	ResponseFormat   any                        `json:"response_format,omitempty"`
	GenerationConfig *geminiGenerationConfig    `json:"generation_config,omitempty"`
	Store            bool                       `json:"store"`
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

type geminiTextResponseFormat struct {
	Type     string `json:"type"`
	MIMEType string `json:"mime_type"`
}

type geminiGenerationConfig struct {
	MaxOutputTokens int    `json:"max_output_tokens,omitempty"`
	ThinkingLevel   string `json:"thinking_level,omitempty"`
}

type geminiInteractionResponse struct {
	OutputImage *geminiInteractionContent `json:"output_image"`
	OutputText  string                    `json:"output_text"`
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

func extractInteractionText(response geminiInteractionResponse) string {
	if strings.TrimSpace(response.OutputText) != "" {
		return response.OutputText
	}
	for _, step := range response.Steps {
		if step.Type != "" && step.Type != "model_output" {
			continue
		}
		for _, content := range step.Content {
			if content.Type == "text" && strings.TrimSpace(content.Text) != "" {
				return content.Text
			}
		}
	}
	return ""
}

func normalizePoseDescription(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	runes := []rune(value)
	if len(runes) > 180 {
		return string(runes[:180])
	}
	return value
}

func poseExtractionPrompt() string {
	return strings.Join([]string{
		"Look at the photo and describe only the human pose information needed for a mascot prompt.",
		"Do not describe identity, faces, age, gender, ethnicity, attractiveness, exact clothing logos, location, scenery, objects, or private details.",
		"Return one concise English sentence about body posture, orientation, arm placement, leg placement, and whether the people are standing or sitting.",
		"If there are multiple people, describe their shared pose or relative posture only.",
	}, "\n")
}

func buildPrompt(input GenerateInput, poseDescription string) string {
	return strings.Join([]string{
		"Create an original cute mascot character for a mobile tourism matching app.",
		"",
		"Concept:",
		"The character represents a memory from a guided experience between two users.",
		"It should not be a direct portrait of the people in the photo.",
		"The goal is to preserve the feeling of the day as a collectible memory character.",
		"",
		"Inputs:",
		"",
		"- Photo: " + strings.TrimSpace(poseDescription),
		"- Most memorable object: " + strings.TrimSpace(input.MemorableObject),
		"- Memory: " + strings.TrimSpace(input.MemoryText),
		"",
		"Character structure - strict rules:",
		"",
		"- The character must have exactly one head and one body.",
		"- The character must have exactly two arms.",
		"- The character must have exactly two legs.",
		"- The character must have two eyes.",
		"- The character must have one small mouth.",
		"- The character must be a full-body character.",
		"- The character must be standing or sitting in a stable, readable pose.",
		"- Do not add extra arms, extra legs, extra hands, extra feet, extra heads, extra eyes, tentacles, wings, or duplicated body parts.",
		"- Hands should be simple mitten-like hands, not detailed human fingers.",
		"- Feet should be simple rounded feet.",
		"- Accessories and object motifs must not look like additional limbs.",
		"",
		"How to reflect the inputs:",
		"",
		"- Use the photo only for the general pose described in the Photo input.",
		"- Do not copy the users' faces or make the character look like a real person.",
		"- Use the most memorable object as the main motif of the character's accessory, body pattern, hat, charm, or held item.",
		"- Use the memory text to decide the character's expression, pose, warmth, and emotional tone.",
		"- Keep the main body shape consistent and change only the character details based on the inputs.",
		"",
		"Style:",
		"soft 3D illustration, rounded shapes, smooth surface, gentle highlights, subtle shadows, simple readable silhouette, friendly expression, cute but not childish, polished mobile app mascot style.",
		"",
		"Design direction:",
		"The character should feel warm, memorable, and collectible.",
		"Keep the design simple and uncluttered.",
		"The character should visually match clean, modern app illustrations with a soft and approachable atmosphere.",
		"Do not make the design too detailed or realistic.",
		"",
		"Strict background rule:",
		"The background must be a solid pure white background: #FFFFFF.",
		"Do not use a transparent background.",
		"Do not add scenery, frames, gradients, patterns, or decorative background elements.",
		"",
		"Output:",
		"single full-body mascot character, centered, solid #FFFFFF background, no text, no logo, no frame.",
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

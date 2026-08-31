package safety

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// TriageProvider receives only evidence the reporting user explicitly chose to
// submit. It never receives a user ID, target ID, location, token, key, or the
// rest of a chat. Implementations must not retain request or response bodies.
type TriageProvider interface {
	Name() string
	Triage(context.Context, TriageRequest) (TriageResult, error)
}

type TriageRequest struct {
	Evidence string
	Language string
}

type TriageResult struct {
	RiskLevel string
	RiskKind  string
	Version   string
}

const (
	TriageNone   = "none"
	TriageLow    = "low"
	TriageMedium = "medium"
	TriageHigh   = "high"
)

var validRiskKinds = map[string]bool{
	"none": true, "harassment": true, "violence": true, "illicit": true,
	"sexual_exploitation": true, "scam": true, "coercion": true,
	"self_harm": true, "other": true,
}

var validRiskLevels = map[string]bool{TriageNone: true, TriageLow: true, TriageMedium: true, TriageHigh: true}

var ErrInvalidTriageEvidence = errors.New("invalid report triage evidence")

const maxTriageEvidenceRunes = 2000

// TriageSubmittedEvidence performs best-effort, consent-bound triage. It does
// not create a public HTTP route: wiring evidence submission requires the
// separate encrypted-evidence and reviewer-key design. A failure is persisted
// as pending/unavailable metadata and never changes report acceptance.
func (s *Service) TriageSubmittedEvidence(ctx context.Context, reportID, reporterID, evidence, language string, consent bool, now time.Time) error {
	if s == nil || s.db == nil || !consent || strings.TrimSpace(reportID) == "" || strings.TrimSpace(reporterID) == "" {
		return ErrInvalidTriageEvidence
	}
	evidence = strings.TrimSpace(evidence)
	if evidence == "" || !utf8.ValidString(evidence) || utf8.RuneCountInString(evidence) > maxTriageEvidenceRunes {
		return ErrInvalidTriageEvidence
	}
	language = normalizeLanguage(language)
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE id=$1 AND reporter_user_id=$2)`, reportID, reporterID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrTargetNotFound
	}
	defer clearString(&evidence)
	triageCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()

	results := make([]TriageResult, 0, len(s.triageProviders))
	providerNames := make([]string, 0, len(s.triageProviders))
	for _, provider := range s.triageProviders {
		if provider == nil {
			continue
		}
		result, err := provider.Triage(triageCtx, TriageRequest{Evidence: evidence, Language: language})
		if err != nil || !validTriageResult(result) {
			continue
		}
		results = append(results, result)
		providerNames = append(providerNames, provider.Name())
	}

	// Missing credentials, timeouts, and malformed provider responses are all
	// retryable pending triage. They must never reject the underlying report.
	state, level, kind := "pending", TriageNone, "none"
	if len(results) > 0 {
		state = "completed"
		level, kind = strongestResult(results)
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	versions := make([]string, 0, len(results))
	for _, result := range results {
		if result.Version != "" {
			versions = append(versions, result.Version)
		}
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO report_triage (report_id,state,risk_level,risk_kind,provider_mask,provider_versions,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (report_id) DO UPDATE SET state=EXCLUDED.state,risk_level=EXCLUDED.risk_level,risk_kind=EXCLUDED.risk_kind,provider_mask=EXCLUDED.provider_mask,provider_versions=EXCLUDED.provider_versions,updated_at=EXCLUDED.updated_at`,
		reportID, state, level, kind, strings.Join(providerNames, ","), strings.Join(versions, ","), stamp)
	if err != nil {
		return err
	}
	if state == "completed" {
		status := "triaged"
		if level == TriageHigh {
			status = "escalated"
		}
		_, err = s.db.ExecContext(ctx, `UPDATE reports SET status=$1,updated_at=$2 WHERE id=$3 AND reporter_user_id=$4 AND status='received'`, status, stamp, reportID, reporterID)
	}
	return err
}

// TODO(safety): Add a separately reviewed, explicit-consent HTTP submission
// route only after the encrypted evidence envelope and reviewer-key boundary
// exist. Do not send ordinary E2EE chat messages through this service.

func validTriageResult(result TriageResult) bool {
	return validRiskLevels[result.RiskLevel] && validRiskKinds[result.RiskKind] && len(result.Version) <= 80
}

func strongestResult(results []TriageResult) (string, string) {
	best := TriageResult{RiskLevel: TriageNone, RiskKind: "none"}
	weight := map[string]int{TriageNone: 0, TriageLow: 1, TriageMedium: 2, TriageHigh: 3}
	for _, result := range results {
		if weight[result.RiskLevel] > weight[best.RiskLevel] {
			best = result
		}
	}
	return best.RiskLevel, best.RiskKind
}

func normalizeLanguage(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) > 16 {
		return ""
	}
	for _, r := range value {
		if !(r == '-' || (r >= 'a' && r <= 'z')) {
			return ""
		}
	}
	return value
}

func clearString(value *string) { *value = "" }

type OpenAIModerationProvider struct {
	apiKey, endpoint, model string
	client                  *http.Client
}

func NewOpenAIModerationProvider(apiKey string, client *http.Client) *OpenAIModerationProvider {
	if strings.TrimSpace(apiKey) == "" {
		return nil
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &OpenAIModerationProvider{apiKey: strings.TrimSpace(apiKey), endpoint: "https://api.openai.com/v1/moderations", model: "omni-moderation-latest", client: client}
}
func (p *OpenAIModerationProvider) Name() string { return "openai_moderation" }
func (p *OpenAIModerationProvider) Triage(ctx context.Context, input TriageRequest) (TriageResult, error) {
	if p == nil || p.client == nil || p.apiKey == "" {
		return TriageResult{}, errors.New("provider unavailable")
	}
	body, err := json.Marshal(map[string]string{"model": p.model, "input": input.Evidence})
	if err != nil {
		return TriageResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return TriageResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return TriageResult{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil || resp.StatusCode < 200 || resp.StatusCode > 299 {
		return TriageResult{}, errors.New("provider response")
	}
	var payload struct {
		Model   string `json:"model"`
		Results []struct {
			Flagged    bool            `json:"flagged"`
			Categories map[string]bool `json:"categories"`
		} `json:"results"`
	}
	if json.Unmarshal(data, &payload) != nil || len(payload.Results) != 1 {
		return TriageResult{}, errors.New("invalid provider response")
	}
	if !payload.Results[0].Flagged {
		return TriageResult{RiskLevel: TriageNone, RiskKind: "none", Version: safeVersion(payload.Model)}, nil
	}
	return TriageResult{RiskLevel: TriageHigh, RiskKind: openAIRiskKind(payload.Results[0].Categories), Version: safeVersion(payload.Model)}, nil
}
func openAIRiskKind(categories map[string]bool) string {
	for _, item := range []struct{ key, kind string }{{"sexual/minors", "sexual_exploitation"}, {"illicit/violent", "illicit"}, {"illicit", "illicit"}, {"violence", "violence"}, {"self-harm", "self_harm"}, {"harassment", "harassment"}} {
		key, kind := item.key, item.kind
		if categories[key] {
			return kind
		}
	}
	return "other"
}

// GeminiTriageProvider is deliberately a structured-result helper. It is only
// constructed with a configured key and validates its response before use.
type GeminiTriageProvider struct {
	apiKey, model, endpoint string
	client                  *http.Client
}

func NewGeminiTriageProvider(apiKey string, client *http.Client) *GeminiTriageProvider {
	if strings.TrimSpace(apiKey) == "" {
		return nil
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &GeminiTriageProvider{apiKey: strings.TrimSpace(apiKey), model: "gemini-3.1-flash-lite", endpoint: "https://generativelanguage.googleapis.com", client: client}
}
func (p *GeminiTriageProvider) Name() string { return "gemini_triage" }
func (p *GeminiTriageProvider) Triage(ctx context.Context, input TriageRequest) (TriageResult, error) {
	if p == nil || p.client == nil || p.apiKey == "" {
		return TriageResult{}, errors.New("provider unavailable")
	}
	prompt := "Classify only this user-consented report evidence. Return strict JSON with risk_level (none|low|medium|high) and risk_kind (none|harassment|violence|illicit|sexual_exploitation|scam|coercion|self_harm|other). Do not explain. Evidence:\n" + input.Evidence
	body, err := json.Marshal(map[string]any{"contents": []map[string]any{{"role": "user", "parts": []map[string]string{{"text": prompt}}}}, "generationConfig": map[string]any{"temperature": 0, "maxOutputTokens": 32, "responseMimeType": "application/json"}})
	if err != nil {
		return TriageResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.endpoint, "/")+"/v1beta/models/"+p.model+":generateContent", bytes.NewReader(body))
	if err != nil {
		return TriageResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", p.apiKey)
	resp, err := p.client.Do(req)
	if err != nil {
		return TriageResult{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil || resp.StatusCode < 200 || resp.StatusCode > 299 {
		return TriageResult{}, errors.New("provider response")
	}
	var payload struct {
		ModelVersion string `json:"modelVersion"`
		Candidates   []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if json.Unmarshal(data, &payload) != nil || len(payload.Candidates) != 1 || len(payload.Candidates[0].Content.Parts) != 1 {
		return TriageResult{}, errors.New("invalid provider response")
	}
	var result TriageResult
	decoder := json.NewDecoder(strings.NewReader(payload.Candidates[0].Content.Parts[0].Text))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil || !validTriageResult(result) {
		return TriageResult{}, errors.New("invalid provider result")
	}
	result.Version = safeVersion(payload.ModelVersion)
	return result, nil
}
func safeVersion(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 80 {
		return ""
	}
	for _, r := range value {
		if r < ' ' || r > '~' {
			return ""
		}
	}
	return value
}

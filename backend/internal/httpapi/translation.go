package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/translation"
)

const translatePath = APIV1Prefix + "/translate"

// translateText renders one short piece of text (typically a decrypted chat
// message the caller is already looking at) into a UI language. Session-gated
// and per-user rate limited; the Gemini key stays on the server.
func translateText(service *translation.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil || !service.Available() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "translation_unavailable"})
			return
		}
		var input struct {
			Text           string `json:"text"`
			TargetLanguage string `json:"target_language"`
		}
		if err := decodeJSONRequest(w, r, &input, 16*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_translation_request"})
			return
		}
		translated, err := service.Translate(r.Context(), claims.Subject, strings.TrimSpace(input.Text), input.TargetLanguage)
		switch {
		case err == nil:
			writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
				"translated_text": translated,
				"target_language": strings.ToLower(strings.TrimSpace(input.TargetLanguage)),
			}})
		case errors.Is(err, translation.ErrInvalidInput):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_translation_request"})
		case errors.Is(err, translation.ErrRateLimited):
			w.Header().Set("Retry-After", "1")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "translation_rate_limited"})
		default:
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "translation_failed"})
		}
	}
}

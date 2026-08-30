package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/classification"
)

func classifyRecruitment(service *classification.Service, sessions *auth.SessionService) http.HandlerFunc {
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
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "recruitment_classification_unavailable"})
			return
		}
		var input struct {
			Description string `json:"description"`
		}
		if err := decodeJSONRequest(w, r, &input, 8*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_classification_request"})
			return
		}
		category, err := service.Classify(r.Context(), claims.Subject, strings.TrimSpace(input.Description))
		switch {
		case err == nil:
			writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"category": category}})
		case errors.Is(err, classification.ErrInvalidInput):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_classification_request"})
		case errors.Is(err, classification.ErrRateLimited):
			w.Header().Set("Retry-After", "2")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "recruitment_classification_rate_limited"})
		default:
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "recruitment_classification_failed"})
		}
	}
}

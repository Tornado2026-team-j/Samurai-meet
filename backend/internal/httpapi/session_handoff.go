package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func sessionHandoffStart(service *auth.SessionHandoffService, sessions *auth.SessionService, environment string, allowExpoGo bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		var input struct {
			AppRedirectURI string `json:"app_redirect_uri"`
			Challenge      string `json:"handoff_challenge"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || !allowedAppRedirectURI(input.AppRedirectURI, environment, allowExpoGo) || strings.TrimSpace(input.Challenge) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_app_redirect"})
			return
		}
		result, err := service.Create(r.Context(), claims.Subject, claims.SessionID, input.AppRedirectURI, input.Challenge, time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "recent_passkey_required"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"handoff_code": result.Code, "app_redirect_uri": result.AppRedirectURI}})
	}
}

func sessionHandoffExchange(service *auth.SessionHandoffService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Code     string `json:"handoff_code"`
			Verifier string `json:"handoff_verifier"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Code == "" || input.Verifier == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		result, err := service.Exchange(r.Context(), input.Code, input.Verifier, time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session_handoff_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

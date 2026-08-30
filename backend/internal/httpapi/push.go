package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/push"
)

const pushSettingsPath = APIV1Prefix + "/me/push-settings"

func pushSettings(service *push.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			result, err := service.Latest(r.Context(), claims.Subject)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "push_settings_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case http.MethodPost:
			var input push.Settings
			if err := decodeJSONRequest(w, r, &input, 16*1024); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_push_settings"})
				return
			}
			result, err := service.Upsert(r.Context(), claims.Subject, input, time.Now())
			if err != nil {
				status := http.StatusInternalServerError
				if errors.Is(err, push.ErrInvalidSettings) {
					status = http.StatusBadRequest
				}
				writeJSON(w, status, map[string]string{"error": "invalid_push_settings"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		default:
			w.Header().Set("Allow", "GET, POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

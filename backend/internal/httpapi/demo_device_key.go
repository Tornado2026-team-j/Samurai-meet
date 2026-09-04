package httpapi

import (
	"errors"
	"net/http"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

func demoDeviceKey(service *chat.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "demo_key_unavailable"})
			return
		}
		var input chat.DemoDeviceKeyInput
		if err := decodeJSONRequest(w, r, &input, 8*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_demo_device_key"})
			return
		}
		key, err := service.RegisterDemoDeviceKey(r.Context(), claims.Subject, input, now())
		switch {
		case errors.Is(err, chat.ErrDemoKeyInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_demo_device_key"})
		case errors.Is(err, chat.ErrDemoKeyConflict):
			writeJSON(w, http.StatusConflict, map[string]string{"error": "demo_device_key_conflict"})
		case errors.Is(err, chat.ErrDemoKeyForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "demo_key_forbidden"})
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "demo_device_key_failed"})
		default:
			writeJSON(w, http.StatusOK, map[string]any{"data": key})
		}
	}
}

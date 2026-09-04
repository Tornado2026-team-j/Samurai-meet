package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func demoAccountStart(service *auth.DemoAccountService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareSensitiveAuthResponse(w)
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "demo_account_disabled"})
			return
		}
		if r.Body == nil || r.ContentLength > 4096 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_demo_account_request"})
			return
		}
		var input struct {
			Language string `json:"language"`
			AppMode  string `json:"app_mode"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		if err := decoder.Decode(&input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_demo_account_request"})
			return
		}
		if err := ensureJSONBodyConsumed(decoder); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_demo_account_request"})
			return
		}
		result, err := service.Start(r.Context(), strings.TrimSpace(input.Language), strings.TrimSpace(input.AppMode), now())
		if errors.Is(err, auth.ErrInvalidDemoAccountRequest) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_demo_account_request"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "demo_account_start_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

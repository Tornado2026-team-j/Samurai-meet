package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func googleStart(service *auth.OAuthLoginService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		url, err := service.Start(r.Context(), time.Now())
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "oauth_unavailable"})
			return
		}
		http.Redirect(w, r, url, http.StatusFound)
	}
}
func googleExchange(service *auth.OAuthLoginService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Code  string `json:"code"`
			State string `json:"state"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Code == "" || request.State == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		result, err := service.Complete(r.Context(), request.Code, request.State, time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "google_exchange_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"user_id": result.UserID, "session_id": result.SessionID, "access_token": result.AccessToken, "refresh_token": result.RefreshToken, "is_new_user": result.IsNewUser}})
	}
}

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

const expoTestRedirectURI = "samuraimeettest://auth"

func allowedAppRedirectURI(raw string) bool {
	if raw == expoTestRedirectURI {
		return true
	}
	uri, err := url.Parse(raw)
	return err == nil && uri.Scheme == "exp" && strings.Contains(uri.Path, "/--/auth")
}

func googleStart(service *auth.OAuthLoginService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		redirectURI, challenge := r.URL.Query().Get("app_redirect_uri"), r.URL.Query().Get("handoff_challenge")
		if !allowedAppRedirectURI(redirectURI) || challenge == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_app_redirect"})
			return
		}
		uri, err := service.Start(r.Context(), time.Now(), redirectURI, challenge)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "oauth_unavailable"})
			return
		}
		http.Redirect(w, r, uri, http.StatusFound)
	}
}

func googleCallback(service *auth.OAuthLoginService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := service.Complete(r.Context(), r.URL.Query().Get("code"), r.URL.Query().Get("state"), time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "google_callback_failed"})
			return
		}
		uri, err := url.Parse(result.AppRedirectURI)
		if err != nil || !allowedAppRedirectURI(result.AppRedirectURI) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_app_redirect"})
			return
		}
		query := uri.Query()
		query.Set("handoff_code", result.Code)
		uri.RawQuery = query.Encode()
		http.Redirect(w, r, uri.String(), http.StatusFound)
	}
}

func googleExchange(service *auth.OAuthLoginService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			HandoffCode     string `json:"handoff_code"`
			HandoffVerifier string `json:"handoff_verifier"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.HandoffCode == "" || request.HandoffVerifier == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		result, err := service.ExchangeHandoff(r.Context(), request.HandoffCode, request.HandoffVerifier, time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "handoff_exchange_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"user_id": result.UserID, "session_id": result.SessionID, "access_token": result.AccessToken, "refresh_token": result.RefreshToken}})
	}
}

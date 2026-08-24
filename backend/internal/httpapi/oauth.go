package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

const (
	productionAppRedirectURI = "samuraimeet://auth"
	expoTestRedirectURI      = "samuraimeettest://auth"
)

func allowedAppRedirectURI(raw, environment string, allowExpoGo bool) bool {
	if raw == productionAppRedirectURI {
		return true
	}
	if !allowExpoGo && environment != "development" && environment != "test" {
		return false
	}
	if raw == expoTestRedirectURI {
		return true
	}
	uri, err := url.Parse(raw)
	return err == nil && uri.Scheme == "exp" && uri.Host != "" && uri.User == nil && strings.HasSuffix(uri.Path, "/--/auth") && uri.Fragment == ""
}

func allowedOAuthRedirectURI(raw, environment string, allowExpoGo bool, clientOrigin, devClientOrigin string) bool {
	if allowedAppRedirectURI(raw, environment, allowExpoGo) {
		return true
	}
	if raw == "" || strings.ContainsAny(raw, "\r\n") {
		return false
	}
	origins := []string{clientOrigin}
	if environment == "development" || environment == "test" {
		origins = append(origins, devClientOrigin, "http://localhost:5173", "http://127.0.0.1:5173")
	}
	for _, origin := range origins {
		origin = strings.TrimRight(strings.TrimSpace(origin), "/")
		if origin != "" && raw == origin+"/auth/complete" {
			return true
		}
	}
	return false
}

func googleStart(service *auth.OAuthLoginService, environment string, allowExpoGo bool, clientOrigin, devClientOrigin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		redirectURI, challenge := r.URL.Query().Get("app_redirect_uri"), r.URL.Query().Get("handoff_challenge")
		if !allowedOAuthRedirectURI(redirectURI, environment, allowExpoGo, clientOrigin, devClientOrigin) || challenge == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_app_redirect"})
			return
		}
		uri, err := service.Start(r.Context(), time.Now(), redirectURI, challenge)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "oauth_unavailable"})
			return
		}
		http.Redirect(w, r, uri, http.StatusFound) // #nosec G710 -- URI is constructed by the server's fixed Google OAuth configuration, not copied from the request
	}
}

func googleCallback(service *auth.OAuthLoginService, environment string, allowExpoGo bool, clientOrigin, devClientOrigin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := service.Complete(r.Context(), r.URL.Query().Get("code"), r.URL.Query().Get("state"), time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "google_callback_failed"})
			return
		}
		uri, err := url.Parse(result.AppRedirectURI)
		if err != nil || !allowedOAuthRedirectURI(result.AppRedirectURI, environment, allowExpoGo, clientOrigin, devClientOrigin) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_app_redirect"})
			return
		}
		query := uri.Query()
		query.Set("handoff_code", result.Code)
		uri.RawQuery = query.Encode()
		http.Redirect(w, r, uri.String(), http.StatusFound) // #nosec G710 -- target passed the fixed production/dev app redirect allow-list above
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
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

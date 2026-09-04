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

func allowedOAuthRedirectURI(raw, environment string, allowExpoGo bool, clientOrigin, devClientOrigin string, additionalClientOrigins ...string) bool {
	if allowedAppRedirectURI(raw, environment, allowExpoGo) {
		return true
	}
	if raw == "" || strings.ContainsAny(raw, "\r\n") {
		return false
	}
	for _, origin := range clientOrigins(environment, clientOrigin, devClientOrigin, additionalClientOrigins...) {
		if raw == origin+"/auth/complete" {
			return true
		}
	}
	return false
}

func googleStart(service *auth.OAuthLoginService, environment string, allowExpoGo bool, clientOrigin, devClientOrigin string, additionalClientOrigins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		redirectURI, challenge := r.URL.Query().Get("app_redirect_uri"), r.URL.Query().Get("handoff_challenge")
		if !allowedOAuthRedirectURI(redirectURI, environment, allowExpoGo, clientOrigin, devClientOrigin, additionalClientOrigins...) || challenge == "" {
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

func googleCallback(service *auth.OAuthLoginService, environment string, allowExpoGo bool, clientOrigin, devClientOrigin string, additionalClientOrigins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareSensitiveAuthResponse(w)
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		result, err := service.Complete(r.Context(), r.URL.Query().Get("code"), r.URL.Query().Get("state"), time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "google_callback_failed"})
			return
		}
		uri, err := url.Parse(result.AppRedirectURI)
		if err != nil || !allowedOAuthRedirectURI(result.AppRedirectURI, environment, allowExpoGo, clientOrigin, devClientOrigin, additionalClientOrigins...) {
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
		prepareSensitiveAuthResponse(w)
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.Body == nil || r.ContentLength > 8*1024 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		var request struct {
			HandoffCode     string `json:"handoff_code"`
			HandoffVerifier string `json:"handoff_verifier"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024))
		if err := decoder.Decode(&request); err != nil || request.HandoffCode == "" || request.HandoffVerifier == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		if err := ensureJSONBodyConsumed(decoder); err != nil {
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

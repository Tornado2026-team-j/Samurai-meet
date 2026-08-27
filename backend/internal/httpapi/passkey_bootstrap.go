package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func passkeyBootstrap(service *auth.PasskeyBootstrapService, sessions *auth.SessionService, preauth *auth.PreAuthService, environment string, allowExpoGo bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareSensitiveAuthResponse(w)
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		var input struct {
			Scope            string `json:"scope"`
			AppRedirectURI   string `json:"app_redirect_uri"`
			HandoffChallenge string `json:"app_handoff_challenge"`
		}
		if r.Body == nil || r.ContentLength > 8*1024 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024))
		if err := decoder.Decode(&input); err != nil || !allowedAppRedirectURI(input.AppRedirectURI, environment, allowExpoGo) || strings.TrimSpace(input.HandoffChallenge) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		if err := ensureJSONBodyConsumed(decoder); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		scope := auth.PasskeyBootstrapScope(input.Scope)
		var result auth.PasskeyBootstrap
		var err error
		if claims, ok := accessClaims(r, sessions); ok {
			if scope != auth.PasskeyBootstrapRegister && scope != auth.PasskeyBootstrapReauth {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_scope"})
				return
			}
			if scope == auth.PasskeyBootstrapRegister && !requireRecentPasskey(r, sessions, claims) {
				writeRecentPasskeyRequired(w)
				return
			}
			result, err = service.IssueFromSession(r.Context(), claims.Subject, claims.SessionID, scope, input.AppRedirectURI, input.HandoffChallenge, time.Now())
		} else if preauth != nil {
			token := authorizationToken(r)
			preScope := auth.PreAuthScope(input.Scope)
			claims, lookupErr := preauth.Lookup(r.Context(), token, preScope, "", time.Now())
			if lookupErr != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
				return
			}
			result, err = service.IssueFromPreAuth(r.Context(), claims.UserID, token, scope, input.AppRedirectURI, input.HandoffChallenge, time.Now())
		} else {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_bootstrap_failed"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"bootstrap_token": result.Token, "scope": result.Scope, "expires_at": result.ExpiresAt.UTC().Format(time.RFC3339Nano)}})
	}
}

package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

// APIV1Prefix is the public API namespace used by both the mobile app and web
// client. A single public domain routes this path to the Go backend.
const APIV1Prefix = "/api/v1"

// NewRouter returns the HTTP routes. Optional services are omitted when the
// corresponding production secret/configuration is not available.
type RouterOptions struct {
	Environment         string
	AllowExpoGoRedirect bool
	DevClientOrigin     string
	ClientOrigin        string
	OAuthLogin          *auth.OAuthLoginService
	Sessions            *auth.SessionService
	Passkeys            *auth.PasskeyService
}

func NewRouter() http.Handler {
	return NewRouterWithOptions(RouterOptions{})
}

func NewRouterWithOptions(options RouterOptions) http.Handler {
	mux := http.NewServeMux()
	// Keep direct probes for local process and infrastructure checks. Product
	// clients must use the versioned public namespace below.
	mux.HandleFunc("/healthz", healthz)
	mux.HandleFunc("/readyz", readyz)
	mux.HandleFunc(APIV1Prefix+"/healthz", healthz)
	mux.HandleFunc(APIV1Prefix+"/readyz", readyz)
	if options.OAuthLogin != nil {
		mux.HandleFunc(APIV1Prefix+"/auth/google/start", googleStart(options.OAuthLogin, options.Environment, options.AllowExpoGoRedirect))
		mux.HandleFunc(APIV1Prefix+"/auth/google/exchange", googleExchange(options.OAuthLogin))
		mux.HandleFunc("/auth/callback", googleCallback(options.OAuthLogin, options.Environment, options.AllowExpoGoRedirect))
	}
	if options.Sessions != nil {
		mux.HandleFunc(APIV1Prefix+"/auth/refresh", refreshSession(options.Sessions))
		mux.HandleFunc(APIV1Prefix+"/auth/logout", logoutSession(options.Sessions))
		mux.HandleFunc(APIV1Prefix+"/auth/logout-all", logoutAllSessions(options.Sessions))
		mux.HandleFunc(APIV1Prefix+"/me/sessions", listSessions(options.Sessions))
		mux.HandleFunc(APIV1Prefix+"/me/sessions/", revokeSession(options.Sessions))
	}
	if options.Passkeys != nil && options.Sessions != nil {
		mux.HandleFunc(APIV1Prefix+"/auth/passkey/register/options", passkeyRegisterOptions(options.Passkeys, options.Sessions))
		mux.HandleFunc(APIV1Prefix+"/auth/passkey/register/verify", passkeyRegisterVerify(options.Passkeys, options.Sessions))
		mux.HandleFunc(APIV1Prefix+"/auth/passkey/login/options", passkeyLoginOptions(options.Passkeys))
		mux.HandleFunc(APIV1Prefix+"/auth/passkey/login/verify", passkeyLoginVerify(options.Passkeys))
		mux.HandleFunc(APIV1Prefix+"/auth/passkey", passkeyList(options.Passkeys, options.Sessions))
		mux.HandleFunc(APIV1Prefix+"/auth/passkey/", passkeyRemove(options.Passkeys, options.Sessions))
	}

	return withCORS(withJSONContentType(mux), options)
}

func withCORS(next http.Handler, options RouterOptions) http.Handler {
	allowedOrigin := options.ClientOrigin
	if allowedOrigin == "" && options.Environment == "development" {
		allowedOrigin = options.DevClientOrigin
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if allowedOrigin != "" && r.Header.Get("Origin") == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func readyz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func withJSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

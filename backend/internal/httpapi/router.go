package httpapi

import (
	"encoding/json"
	"net/http"
)

// APIV1Prefix is the public API namespace used by both the mobile app and web
// client. A single public domain routes this path to the Go backend.
const APIV1Prefix = "/api/v1"

// NewRouter returns the initial HTTP routes. Authentication routes are added
// after the OAuth, Passkey, and database repositories are implemented.
type RouterOptions struct {
	Environment     string
	DevClientOrigin string
	ClientOrigin    string
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

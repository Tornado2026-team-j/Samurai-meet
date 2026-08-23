package httpapi

import (
	"encoding/json"
	"net/http"
)

// NewRouter returns the initial HTTP routes. Authentication routes are added
// after the OAuth, Passkey, and database repositories are implemented.
type RouterOptions struct {
	Environment     string
	DevClientOrigin string
}

func NewRouter() http.Handler {
	return NewRouterWithOptions(RouterOptions{})
}

func NewRouterWithOptions(options RouterOptions) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthz)
	mux.HandleFunc("/readyz", readyz)

	return withCORS(withJSONContentType(mux), options)
}

func withCORS(next http.Handler, options RouterOptions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if options.Environment == "development" && r.Header.Get("Origin") == options.DevClientOrigin {
			w.Header().Set("Access-Control-Allow-Origin", options.DevClientOrigin)
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

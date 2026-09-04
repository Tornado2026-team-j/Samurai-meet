package httpapi

import (
	"encoding/json"
	"net/http"
)

// webAuthnRelatedOrigins serves the WebAuthn Level 3 related-origin document
// from the configured RP ID host. This lets a separately hosted preview web
// client use the same RP ID and existing credentials without widening the
// RP's origin check to arbitrary subdomains.
func webAuthnRelatedOrigins(environment, clientOrigin, devClientOrigin string, additionalClientOrigins []string) http.HandlerFunc {
	origins := clientOrigins(environment, clientOrigin, devClientOrigin, additionalClientOrigins...)
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if len(origins) == 0 {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=300")
		// The resource contains no credentials and is intended to be fetched by
		// the browser's WebAuthn implementation, not by an authenticated API
		// client.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return
		}
		_ = json.NewEncoder(w).Encode(struct {
			Origins []string `json:"origins"`
		}{Origins: origins})
	}
}

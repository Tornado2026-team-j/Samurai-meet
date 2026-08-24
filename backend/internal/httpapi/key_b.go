package httpapi

import (
	"errors"
	"net/http"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const keyBPath = APIV1Prefix + "/me/key-b"

// keyB returns Key-B only after a fresh Passkey assertion. The caller must
// retain the returned value in memory only; it is never logged or persisted by
// the server in plaintext.
func keyB(service *keys.KeyBService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRecentPasskey(r, sessions, claims) {
			writeRecentPasskeyRequired(w)
			return
		}
		result, err := service.GetOrCreate(r.Context(), claims.Subject, now())
		if errors.Is(err, keys.ErrKeyBUnavailable) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "key_b_unavailable"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key_b_retrieval_failed"})
			return
		}
		writeKeyBMaterial(w, result)
	}
}

func writeKeyBMaterial(w http.ResponseWriter, result keys.KeyBMaterial) {
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

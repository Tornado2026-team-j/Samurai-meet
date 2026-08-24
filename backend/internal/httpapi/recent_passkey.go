package httpapi

import (
	"net/http"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

// requireRecentPasskey is the common authorization boundary for operations
// that expose or destroy recovery material. A refresh-derived access token is
// insufficient: the current active session must have completed a Passkey
// assertion within auth.RecentPasskeyAuthTTL.
func requireRecentPasskey(r *http.Request, sessions *auth.SessionService, claims auth.AccessClaims) bool {
	if sessions == nil {
		return false
	}
	ok, err := sessions.HasRecentPasskey(r.Context(), claims.Subject, claims.SessionID, now())
	return err == nil && ok
}

func writeRecentPasskeyRequired(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, map[string]string{"error": "recent_passkey_authentication_required"})
}

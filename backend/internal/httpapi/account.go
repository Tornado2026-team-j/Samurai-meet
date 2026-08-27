package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/account"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func deleteAccount(service *account.Service, sessions *auth.SessionService, preauthServices ...*auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareSensitiveAuthResponse(w)
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var (
			userID    string
			authorize func(*sql.Tx) error
		)
		claims, ok := accessClaims(r, sessions)
		if ok {
			if !requireRecentPasskey(r, sessions, claims) {
				writeRecentPasskeyRequired(w)
				return
			}
			userID = claims.Subject
		} else if len(preauthServices) > 0 && preauthServices[0] != nil {
			preauth := preauthServices[0]
			token := authorizationToken(r)
			preClaims, lookupErr := preauth.Lookup(r.Context(), token, auth.PreAuthScopeRegister, "", now())
			if lookupErr != nil || !preClaims.RecoveryVerified {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
				return
			}
			userID = preClaims.UserID
			authorize = func(tx *sql.Tx) error {
				return preauth.ConsumeTx(tx, token, auth.PreAuthScopeRegister, userID, now())
			}
		} else {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "account_deletion_unavailable"})
			return
		}
		var input struct {
			Confirm string `json:"confirm"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.Confirm) != "DELETE" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "account_deletion_confirmation_required"})
			return
		}
		if err := ensureJSONBodyConsumed(decoder); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "account_deletion_confirmation_required"})
			return
		}
		var deleteErr error
		if authorize != nil {
			deleteErr = service.DeleteWithAuthorization(r.Context(), userID, time.Now(), authorize)
		} else {
			deleteErr = service.Delete(r.Context(), userID, time.Now())
		}
		if errors.Is(deleteErr, auth.ErrPreAuth) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if errors.Is(deleteErr, account.ErrAccountNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "account_not_found"})
			return
		} else if errors.Is(deleteErr, account.ErrStorageCleanupPending) {
			// The account and all database ciphertext metadata are already gone.
			// The durable job will retry deleting the user's ciphertext directory.
			writeJSON(w, http.StatusAccepted, map[string]string{"status": "deleted", "cleanup": "pending"})
			return
		} else if deleteErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "account_deletion_failed"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

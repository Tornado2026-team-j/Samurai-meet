package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

const passkeyCeremonyHTTPHeader = "X-Passkey-Ceremony-Token" // #nosec G101 -- protocol header name, not a credential

func passkeyRegisterOptions(passkeys *auth.PasskeyService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		result, err := passkeys.BeginRegistration(r.Context(), claims.Subject, now())
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "passkey_registration_options_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyRegisterVerify(passkeys *auth.PasskeyService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		token := strings.TrimSpace(r.Header.Get(passkeyCeremonyHTTPHeader))
		if token == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_passkey_ceremony_token"})
			return
		}
		if err := passkeys.FinishRegistration(r.Context(), claims.Subject, token, r, now()); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_registration_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "registered"})
	}
}

func passkeyLoginOptions(passkeys *auth.PasskeyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			UserID string `json:"user_id"`
		}
		if r.Body != nil {
			if err := decodeOptionalJSON(r, &input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
				return
			}
		}
		result, err := passkeys.BeginLogin(r.Context(), input.UserID, now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_login_options_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyLoginVerify(passkeys *auth.PasskeyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.Header.Get(passkeyCeremonyHTTPHeader))
		if token == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_passkey_ceremony_token"})
			return
		}
		result, err := passkeys.FinishLogin(r.Context(), token, r, now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_login_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyList(passkeys *auth.PasskeyService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		result, err := passkeys.ListCredentials(r.Context(), claims.Subject)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "passkey_list_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyRemove(passkeys *auth.PasskeyService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		credentialID := strings.TrimPrefix(r.URL.Path, APIV1Prefix+"/auth/passkey/")
		if credentialID == "" || strings.Contains(credentialID, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_credential_id"})
			return
		}
		if err := passkeys.RemoveCredential(r.Context(), claims.Subject, credentialID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "passkey_not_found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "passkey_remove_failed"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func decodeOptionalJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return nil
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); errors.Is(err, io.EOF) {
		return nil
	} else {
		return err
	}
}

func now() time.Time { return time.Now() }

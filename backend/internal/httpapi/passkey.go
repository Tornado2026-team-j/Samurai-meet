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

func authorizationToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < len("Bearer ") || !strings.EqualFold(header[:len("Bearer ")], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[len("Bearer "):])
}

func passkeyRegisterOptions(passkeys *auth.PasskeyService, sessions *auth.SessionService, preauth *auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		userID := ""
		preAuthToken := ""
		preAuthRegistration := false
		if ok {
			if !requireRegularAccount(w, claims) {
				return
			}
			if !requireRecentPasskey(r, sessions, claims) {
				writeRecentPasskeyRequired(w)
				return
			}
			userID = claims.Subject
		} else if preauth != nil {
			preAuthToken = authorizationToken(r)
			preClaims, preAuthOK := preauth.Lookup(r.Context(), preAuthToken, auth.PreAuthScopeRegister, "", now())
			if preAuthOK == nil {
				userID = preClaims.UserID
				preAuthRegistration = true
			} else {
				preAuthToken = ""
			}
		}
		if userID == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		var result auth.PasskeyOptions
		var err error
		if preAuthRegistration {
			result, err = passkeys.BeginRegistrationForPreAuth(r.Context(), userID, now())
		} else {
			result, err = passkeys.BeginRegistration(r.Context(), userID, now())
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "passkey_registration_options_failed"})
			return
		}
		_ = preAuthToken // the token is revalidated during verify; this keeps options stateless
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyRegisterVerify(passkeys *auth.PasskeyService, sessions *auth.SessionService, preauth *auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		userID := ""
		preAuthToken := ""
		if ok {
			if !requireRegularAccount(w, claims) {
				return
			}
			if !requireRecentPasskey(r, sessions, claims) {
				writeRecentPasskeyRequired(w)
				return
			}
			userID = claims.Subject
		} else if preauth != nil {
			preAuthToken = authorizationToken(r)
			preClaims, preAuthOK := preauth.Lookup(r.Context(), preAuthToken, auth.PreAuthScopeRegister, "", now())
			if preAuthOK == nil {
				userID = preClaims.UserID
			} else {
				preAuthToken = ""
			}
		}
		if userID == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		token := strings.TrimSpace(r.Header.Get(passkeyCeremonyHTTPHeader))
		if token == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_passkey_ceremony_token"})
			return
		}
		if r.Body == nil || r.ContentLength > 128<<10 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_passkey_response"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
		result, err := passkeys.FinishRegistration(r.Context(), userID, token, r, now(), preAuthToken)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_registration_failed"})
			return
		}
		if preAuthToken != "" {
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "registered"})
	}
}

func passkeyLoginOptions(passkeys *auth.PasskeyService, preauth *auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		var input struct {
			UserID string `json:"user_id"`
		}
		if r.Body != nil {
			if err := decodeOptionalJSON(w, r, &input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
				return
			}
		}
		if preauth != nil {
			token := authorizationToken(r)
			if token != "" {
				claims, err := preauth.Lookup(r.Context(), token, auth.PreAuthScopeLogin, "", now())
				if err != nil {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_pre_auth_token"})
					return
				}
				input.UserID = claims.UserID
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

func passkeyLoginVerify(passkeys *auth.PasskeyService, preauth *auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		token := strings.TrimSpace(r.Header.Get(passkeyCeremonyHTTPHeader))
		if token == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_passkey_ceremony_token"})
			return
		}
		if r.Body == nil || r.ContentLength > 128<<10 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_passkey_response"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
		preAuthToken := ""
		expectedUserID := ""
		if preauth != nil && authorizationToken(r) != "" {
			preAuthToken = authorizationToken(r)
			claims, lookupErr := preauth.Lookup(r.Context(), preAuthToken, auth.PreAuthScopeLogin, "", now())
			if lookupErr != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_pre_auth_token"})
				return
			}
			expectedUserID = claims.UserID
		}
		result, err := passkeys.FinishLogin(r.Context(), token, r, now(), preAuthToken, expectedUserID)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_login_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyReauthOptions(passkeys *auth.PasskeyService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRegularAccount(w, claims) {
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		result, err := passkeys.BeginReauth(r.Context(), claims.Subject, now())
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "passkey_reauth_options_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyReauthVerify(passkeys *auth.PasskeyService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRegularAccount(w, claims) {
			return
		}
		token := strings.TrimSpace(r.Header.Get(passkeyCeremonyHTTPHeader))
		if token == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_passkey_ceremony_token"})
			return
		}
		if r.Body == nil || r.ContentLength > 128<<10 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_passkey_response"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
		if err := passkeys.FinishReauth(r.Context(), claims.Subject, claims.SessionID, token, r, now()); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_reauth_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "reauthenticated"})
	}
}

func passkeyList(passkeys *auth.PasskeyService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRegularAccount(w, claims) {
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
		if !requireRegularAccount(w, claims) {
			return
		}
		if r.Method != http.MethodDelete {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		if !requireRecentPasskey(r, sessions, claims) {
			writeRecentPasskeyRequired(w)
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

func decodeOptionalJSON(w http.ResponseWriter, r *http.Request, target any) error {
	if r.Body == nil {
		return nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); errors.Is(err, io.EOF) {
		return nil
	} else if err != nil {
		return err
	}
	return ensureJSONBodyConsumed(decoder)
}

func now() time.Time { return time.Now() }

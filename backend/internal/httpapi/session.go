package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func accessClaims(r *http.Request, service *auth.SessionService) (auth.AccessClaims, bool) {
	if service == nil {
		return auth.AccessClaims{}, false
	}
	token := authorizationToken(r)
	if token == "" {
		return auth.AccessClaims{}, false
	}
	claims, err := service.Authenticate(r.Context(), token, time.Now())
	return claims, err == nil
}

func refreshSession(service *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareSensitiveAuthResponse(w)
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var input struct {
			RefreshToken     string `json:"refresh_token"`
			RequestID        string `json:"request_id"`
			RefreshRequestID string `json:"refresh_request_id"`
		}
		if r.Body == nil || r.ContentLength > 16*1024 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
		if err := decoder.Decode(&input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		if err := ensureJSONBodyConsumed(decoder); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		if input.RequestID == "" {
			input.RequestID = input.RefreshRequestID
		}
		input.RefreshToken = strings.TrimSpace(input.RefreshToken)
		input.RequestID = strings.TrimSpace(input.RequestID)
		if input.RefreshToken == "" || input.RequestID == "" || len(input.RefreshToken) > 512 || len(input.RequestID) > 128 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		result, err := service.Refresh(r.Context(), input.RefreshToken, input.RequestID, time.Now())
		if errors.Is(err, auth.ErrRefreshReuse) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "refresh_reuse_detected"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "refresh_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}
func logoutSession(service *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		token := authorizationToken(r)
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_access_token"})
			return
		}
		if err := service.Logout(r.Context(), token, time.Now()); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "logout_failed"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func logoutAllSessions(service *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, service)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if err := service.RevokeAll(r.Context(), claims.Subject, "logout_all", time.Now()); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "logout_all_failed"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func listSessions(service *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, service)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		result, err := service.ListForUser(r.Context(), claims.Subject, claims.SessionID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "session_list_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func revokeSession(service *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, service)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, APIV1Prefix+"/me/sessions/")
		if id == "" || strings.Contains(id, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_session_id"})
			return
		}
		if err := service.RevokeOwnedSession(r.Context(), claims.Subject, id, "revoked_by_user", time.Now()); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "session_not_found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "session_revoke_failed"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

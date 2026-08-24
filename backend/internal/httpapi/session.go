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
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < len("Bearer ") || !strings.EqualFold(header[:len("Bearer ")], "Bearer ") {
		return auth.AccessClaims{}, false
	}
	claims, err := service.Authenticate(r.Context(), strings.TrimSpace(header[len("Bearer "):]), time.Now())
	return claims, err == nil
}

func refreshSession(service *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			RefreshToken     string `json:"refresh_token"`
			RequestID        string `json:"request_id"`
			RefreshRequestID string `json:"refresh_request_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
			return
		}
		if input.RequestID == "" {
			input.RequestID = input.RefreshRequestID
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
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == r.Header.Get("Authorization") || token == "" {
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

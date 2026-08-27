package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/account"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	profileuser "github.com/Tornado2026-team-j/Samurai-meet/backend/internal/user"
)

func meHandler(profiles *profileuser.Service, accounts *account.Service, sessions *auth.SessionService, preauthServices ...*auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			getProfile(profiles, sessions)(w, r)
		case http.MethodPatch:
			patchProfile(profiles, sessions)(w, r)
		case http.MethodDelete:
			deleteAccount(accounts, sessions, preauthServices...)(w, r)
		default:
			w.Header().Set("Allow", "GET, PATCH, DELETE")
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func getProfile(service *profileuser.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "profile_unavailable"})
			return
		}
		profile, err := service.Get(r.Context(), claims.Subject)
		if errors.Is(err, profileuser.ErrUserNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "account_not_found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "profile_read_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": profile})
	}
}

func patchProfile(service *profileuser.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "profile_unavailable"})
			return
		}
		var input profileuser.ProfilePatch
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
		if err := decoder.Decode(&input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_profile_request"})
			return
		}
		if err := ensureJSONBodyConsumed(decoder); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_profile_request"})
			return
		}
		profile, err := service.Patch(r.Context(), claims.Subject, input, time.Now())
		if errors.Is(err, profileuser.ErrInvalidProfile) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_profile"})
			return
		}
		if errors.Is(err, profileuser.ErrUserNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "account_not_found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "profile_update_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": profile})
	}
}

func ensureJSONBodyConsumed(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

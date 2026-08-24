package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const keyEnvelopePrefix = APIV1Prefix + "/me/key-envelopes"

func keyEnvelopeList(service *keys.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRecentPasskey(r, sessions, claims) {
			writeRecentPasskeyRequired(w)
			return
		}
		switch r.Method {
		case http.MethodGet:
			result, err := service.List(r.Context(), claims.Subject)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key_envelope_list_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case http.MethodPut:
			var input keys.Envelope
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_key_envelope_request"})
				return
			}
			result, err := service.Upsert(r.Context(), claims.Subject, input, time.Now())
			if errors.Is(err, keys.ErrInvalidEnvelope) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_key_envelope"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key_envelope_save_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func keyEnvelopeItem(service *keys.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRecentPasskey(r, sessions, claims) {
			writeRecentPasskeyRequired(w)
			return
		}
		version := strings.TrimPrefix(r.URL.Path, keyEnvelopePrefix+"/")
		if version == "" || strings.Contains(version, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_key_version"})
			return
		}
		switch r.Method {
		case http.MethodPut:
			var input keys.Envelope
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_key_envelope_request"})
				return
			}
			if input.KeyVersion == "" {
				input.KeyVersion = version
			}
			if input.KeyVersion != version {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "key_version_mismatch"})
				return
			}
			result, err := service.Upsert(r.Context(), claims.Subject, input, time.Now())
			if errors.Is(err, keys.ErrInvalidEnvelope) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_key_envelope"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key_envelope_save_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case http.MethodGet:
			result, err := service.Get(r.Context(), claims.Subject, version)
			if errors.Is(err, keys.ErrEnvelopeNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "key_envelope_not_found"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key_envelope_get_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case http.MethodDelete:
			if err := service.Delete(r.Context(), claims.Subject, version); errors.Is(err, keys.ErrEnvelopeNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "key_envelope_not_found"})
				return
			} else if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key_envelope_delete_failed"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/safety"
)

const (
	reportsPath  = APIV1Prefix + "/reports"
	blocksPath   = APIV1Prefix + "/blocks"
	meBlocksPath = APIV1Prefix + "/me/blocks"
)

func createReport(service *safety.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "safety_unavailable"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var input safety.ReportInput
		if err := decodeJSONRequest(w, r, &input, 16*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_report_request"})
			return
		}
		report, err := service.CreateReport(r.Context(), claims.Subject, input, time.Now())
		if err != nil {
			writeSafetyError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"data": report})
	}
}

func blockCollection(service *safety.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "safety_unavailable"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			blocked, err := service.ListBlocks(r.Context(), claims.Subject)
			if err != nil {
				writeSafetyError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": blocked})
		case http.MethodPost:
			var input struct {
				UserID string `json:"user_id"`
			}
			if err := decodeJSONRequest(w, r, &input, 8*1024); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_block_request"})
				return
			}
			if err := service.BlockUser(r.Context(), claims.Subject, input.UserID, time.Now()); err != nil {
				writeSafetyError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.Header().Set("Allow", "GET, POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func blockItem(service *safety.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "safety_unavailable"})
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		raw := strings.Trim(strings.TrimPrefix(r.URL.Path, blocksPath+"/"), "/")
		blockedID, err := url.PathUnescape(raw)
		if err != nil || blockedID == "" || strings.Contains(blockedID, "/") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "block_not_found"})
			return
		}
		if err := service.Unblock(r.Context(), claims.Subject, blockedID); err != nil {
			writeSafetyError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func writeSafetyError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "safety_failed"
	switch {
	case errors.Is(err, safety.ErrInvalidReport):
		status, code = http.StatusBadRequest, "invalid_report_request"
	case errors.Is(err, safety.ErrInvalidBlock), errors.Is(err, safety.ErrSelfBlock):
		status, code = http.StatusBadRequest, "invalid_block_request"
	case errors.Is(err, safety.ErrTargetNotFound):
		status, code = http.StatusNotFound, "target_not_found"
	case errors.Is(err, safety.ErrBlockNotFound):
		status, code = http.StatusNotFound, "block_not_found"
	}
	writeJSON(w, status, map[string]string{"error": code})
}

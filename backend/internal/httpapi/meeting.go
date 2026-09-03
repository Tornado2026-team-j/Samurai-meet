package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/meeting"
)

const meetingPath = APIV1Prefix + "/meetings"

func meetingItem(service *meeting.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "meeting_unavailable"})
			return
		}
		meetingID, action, ok := meetingPathParts(r.URL.Path)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "meeting_not_found"})
			return
		}
		switch action {
		case "":
			if r.Method != http.MethodGet {
				w.Header().Set("Allow", http.MethodGet)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			result, err := service.Get(r.Context(), claims.Subject, meetingID)
			if err != nil {
				writeMeetingError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case "start":
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", http.MethodPost)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			result, err := service.Start(r.Context(), claims.Subject, meetingID, time.Now())
			if err != nil {
				writeMeetingError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case "end":
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", http.MethodPost)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			result, err := service.End(r.Context(), claims.Subject, meetingID, time.Now())
			if err != nil {
				writeMeetingError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case "cancel":
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", http.MethodPost)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			result, err := service.Cancel(r.Context(), claims.Subject, meetingID, time.Now())
			if err != nil {
				writeMeetingError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case "resume":
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", http.MethodPost)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			result, err := service.Resume(r.Context(), claims.Subject, meetingID, time.Now())
			if err != nil {
				writeMeetingError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case "proximity":
			meetingProximity(w, r, service, claims.Subject, meetingID)
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "meeting_not_found"})
		}
	}
}

func meetingProximity(w http.ResponseWriter, r *http.Request, service *meeting.Service, userID, meetingID string) {
	switch r.Method {
	case http.MethodGet:
		items, err := service.ListProximity(r.Context(), userID, meetingID, time.Now())
		if err != nil {
			writeMeetingError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": items})
	case http.MethodPost:
		var input meeting.ProximityInput
		if err := decodeJSONRequest(w, r, &input, 16*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_meeting_request"})
			return
		}
		result, err := service.SubmitProximity(r.Context(), userID, meetingID, input, time.Now())
		if err != nil {
			writeMeetingError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"data": result})
	default:
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func meetingPathParts(path string) (string, string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, meetingPath+"/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 1 || len(parts) > 2 || parts[0] == "" {
		return "", "", false
	}
	meetingID, err := url.PathUnescape(parts[0])
	if err != nil || meetingID == "" {
		return "", "", false
	}
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	return meetingID, action, true
}

func writeMeetingError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "meeting_failed"
	switch {
	case errors.Is(err, meeting.ErrMeetingInvalidInput):
		status, code = http.StatusBadRequest, "invalid_meeting_request"
	case errors.Is(err, meeting.ErrMeetingNotFound), errors.Is(err, meeting.ErrMeetingBlocked):
		status, code = http.StatusNotFound, "meeting_not_found"
	case errors.Is(err, meeting.ErrMeetingForbidden):
		status, code = http.StatusForbidden, "meeting_forbidden"
	case errors.Is(err, meeting.ErrMeetingUnavailable):
		status, code = http.StatusConflict, "meeting_not_available"
	case errors.Is(err, meeting.ErrMeetingInvalidState):
		status, code = http.StatusConflict, "invalid_meeting_state"
	}
	writeJSON(w, status, map[string]string{"error": code})
}

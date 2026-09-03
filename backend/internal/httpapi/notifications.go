package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
)

const notificationPath = APIV1Prefix + "/notifications"

func notificationCollection(service *notification.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "notifications_unavailable"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		params, err := notificationListParams(r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_notification_request"})
			return
		}
		items, err := service.List(r.Context(), claims.Subject, params, time.Now())
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": items})
	}
}

func notificationReadAll(service *notification.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "notifications_unavailable"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if err := service.MarkAllRead(r.Context(), claims.Subject, time.Now()); err != nil {
			writeNotificationError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func notificationItem(service *notification.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "notifications_unavailable"})
			return
		}
		notificationID, action, ok := notificationPathParts(r.URL.Path)
		if !ok || action != "read" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "notification_not_found"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if err := service.MarkRead(r.Context(), claims.Subject, notificationID, time.Now()); err != nil {
			writeNotificationError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func notificationListParams(r *http.Request) (notification.ListParams, error) {
	query := r.URL.Query()
	params := notification.ListParams{}
	if value := strings.TrimSpace(query.Get("unread_only")); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return notification.ListParams{}, err
		}
		params.UnreadOnly = parsed
	}
	if value := strings.TrimSpace(query.Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			return notification.ListParams{}, errors.New("invalid notification limit")
		}
		params.Limit = parsed
	}
	return params, nil
}

func notificationPathParts(path string) (string, string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, notificationPath+"/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	notificationID, err := url.PathUnescape(parts[0])
	if err != nil || strings.TrimSpace(notificationID) == "" {
		return "", "", false
	}
	return notificationID, parts[1], true
}

func writeNotificationError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "notifications_failed"
	switch {
	case errors.Is(err, notification.ErrInvalidInput):
		status, code = http.StatusBadRequest, "invalid_notification_request"
	case errors.Is(err, notification.ErrNotificationNotFound):
		status, code = http.StatusNotFound, "notification_not_found"
	}
	writeJSON(w, status, map[string]string{"error": code})
}

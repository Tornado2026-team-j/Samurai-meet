package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

const chatPath = APIV1Prefix + "/chats"

func chatCollection(service *chat.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_unavailable"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		items, err := service.List(r.Context(), claims.Subject, time.Now())
		if err != nil {
			writeChatError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": items})
	}
}

func chatItem(service *chat.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_unavailable"})
			return
		}
		chatID, rest, ok := chatPathParts(r.URL.Path)
		if !ok || len(rest) == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat_not_found"})
			return
		}
		switch {
		case rest[0] == "messages" && len(rest) == 1:
			chatMessages(w, r, service, claims.Subject, chatID)
		case rest[0] == "read" && len(rest) == 1:
			chatRead(w, r, service, claims.Subject, chatID)
		case rest[0] == "transport-token" && len(rest) == 1:
			chatTransportToken(w, r, service, claims.Subject, claims.SessionID, chatID)
		case rest[0] == "attachments" && len(rest) == 1:
			chatAttachmentUpload(w, r, service, claims.Subject, chatID)
		case rest[0] == "attachments" && len(rest) == 2:
			chatAttachmentDownload(w, r, service, claims.Subject, chatID, rest[1])
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat_not_found"})
		}
	}
}

func chatMessages(w http.ResponseWriter, r *http.Request, service *chat.Service, userID, chatID string) {
	switch r.Method {
	case http.MethodGet:
		after, limit, err := chatQuery(r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
			return
		}
		page, err := service.ListMessages(r.Context(), userID, chatID, after, limit, time.Now())
		if err != nil {
			writeChatError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": page})
	case http.MethodPost:
		var input chat.SendMessageInput
		if err := decodeJSONRequest(w, r, &input, 192*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
			return
		}
		message, _, err := service.SendMessage(r.Context(), userID, chatID, input, time.Now())
		if err != nil {
			writeChatError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"data": message})
	default:
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func chatRead(w http.ResponseWriter, r *http.Request, service *chat.Service, userID, chatID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var input struct {
		LastMessageSequence int64 `json:"last_message_sequence"`
	}
	if err := decodeJSONRequest(w, r, &input, 8*1024); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
		return
	}
	if err := service.MarkRead(r.Context(), userID, chatID, input.LastMessageSequence, time.Now()); err != nil {
		writeChatError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func chatTransportToken(w http.ResponseWriter, r *http.Request, service *chat.Service, userID, sessionID, chatID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	transport := "websocket"
	if r.Body != nil && (r.ContentLength != 0 || r.Header.Get("Transfer-Encoding") != "") {
		var input struct {
			Transport string `json:"transport"`
		}
		if err := decodeOptionalJSONRequest(w, r, &input, 8*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
			return
		}
		if strings.TrimSpace(input.Transport) != "" {
			transport = input.Transport
		}
	}
	token, err := service.IssueTransportToken(r.Context(), userID, sessionID, chatID, transport, time.Now())
	if err != nil {
		writeChatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": token})
}

func chatQuery(r *http.Request) (int64, int, error) {
	after := int64(0)
	if value := strings.TrimSpace(r.URL.Query().Get("after")); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed < 0 {
			return 0, 0, err
		}
		after = parsed
	}
	limit := 0
	if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			return 0, 0, err
		}
		limit = parsed
	}
	return after, limit, nil
}

func chatPathParts(path string) (string, []string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, chatPath+"/"), "/")
	if trimmed == "" {
		return "", nil, false
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || len(parts) > 3 {
		return "", nil, false
	}
	for _, part := range parts {
		if part == "" {
			return "", nil, false
		}
	}
	chatID, err := url.PathUnescape(parts[0])
	if err != nil || chatID == "" {
		return "", nil, false
	}
	rest := parts[1:]
	if len(rest) == 2 {
		tail, err := url.PathUnescape(rest[1])
		if err != nil || tail == "" || strings.Contains(tail, "/") {
			return "", nil, false
		}
		rest[1] = tail
	}
	return chatID, rest, true
}

func decodeOptionalJSONRequest(w http.ResponseWriter, r *http.Request, destination any, maxBytes int64) error {
	if r.Body == nil {
		return nil
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	if err := decoder.Decode(destination); errors.Is(err, io.EOF) {
		return nil
	} else if err != nil {
		return err
	}
	return ensureJSONBodyConsumed(decoder)
}

func writeChatError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "chat_failed"
	if rateLimited := (*chat.RateLimitError)(nil); errors.As(err, &rateLimited) {
		seconds := int(rateLimited.RetryAfter.Round(time.Second) / time.Second)
		if seconds < 1 {
			seconds = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "chat_rate_limited"})
		return
	}
	switch {
	case errors.Is(err, chat.ErrChatInvalidInput):
		status, code = http.StatusBadRequest, "invalid_chat_request"
	case errors.Is(err, chat.ErrMessageTooLarge):
		status, code = http.StatusRequestEntityTooLarge, "chat_message_too_large"
	case errors.Is(err, chat.ErrChatAttachmentTooLarge):
		status, code = http.StatusRequestEntityTooLarge, "chat_attachment_too_large"
	case errors.Is(err, chat.ErrChatNotFound), errors.Is(err, chat.ErrChatBlocked), errors.Is(err, chat.ErrMessageNotFound), errors.Is(err, chat.ErrChatAttachmentNotFound):
		status, code = http.StatusNotFound, "chat_not_found"
	case errors.Is(err, chat.ErrChatForbidden):
		status, code = http.StatusForbidden, "chat_forbidden"
	case errors.Is(err, chat.ErrChatNotAvailable):
		status, code = http.StatusConflict, "chat_not_available"
	case errors.Is(err, chat.ErrTooManyPendingAttachments):
		status, code = http.StatusConflict, "too_many_pending_attachments"
	case errors.Is(err, chat.ErrChatSignerMissing):
		status, code = http.StatusServiceUnavailable, "chat_transport_unavailable"
	case errors.Is(err, chat.ErrChatAttachmentUnavailable):
		status, code = http.StatusServiceUnavailable, "chat_attachment_unavailable"
	}
	writeJSON(w, status, map[string]string{"error": code})
}

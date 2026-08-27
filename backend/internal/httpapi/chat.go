package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

const chatsPrefix = APIV1Prefix + "/chats"

// chatList handles GET /chats: every accepted chat for the caller, with a
// last-message preview and unread count.
func chatList(service *chat.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		chats, err := service.ListChats(r.Context(), claims.Subject)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "chat_list_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": chats})
	}
}

type sendMessageInput struct {
	Body            string `json:"body"`
	ClientMessageID string `json:"client_message_id"`
}

// chatMessages handles GET /chats/{id}/messages (history, optionally
// ?after=<server_message_id>&limit=<n>) and POST /chats/{id}/messages (send;
// the REST fallback for when the WebSocket transport isn't connected).
func chatMessages(service *chat.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, chatsPrefix+"/")
		chatID, action, hasAction := strings.Cut(rest, "/")
		if chatID == "" || !hasAction || action != "messages" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat_not_found"})
			return
		}

		switch r.Method {
		case http.MethodGet:
			after, ok := parseAfterParam(w, r)
			if !ok {
				return
			}
			limit, ok := parseLimitParam(w, r)
			if !ok {
				return
			}
			messages, err := service.ListMessages(r.Context(), chatID, claims.Subject, after, limit)
			writeChatMessagesResult(w, messages, err)
		case http.MethodPost:
			var input sendMessageInput
			if r.Body == nil || r.ContentLength > 8192 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_message"})
				return
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
			if err := decoder.Decode(&input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_message"})
				return
			}
			message, err := service.SendMessage(r.Context(), chatID, claims.Subject, input.ClientMessageID, input.Body, time.Now())
			writeSendMessageResult(w, message, err)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func parseAfterParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := r.URL.Query().Get("after")
	if raw == "" {
		return 0, true
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || parsed < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_after"})
		return 0, false
	}
	return parsed, true
}

func parseLimitParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 0, true
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_limit"})
		return 0, false
	}
	return parsed, true
}

// writeChatAuthorizationError writes the response for errors shared by every
// chat operation (not found / not a participant / not accepted or blocked).
// It reports whether it handled err.
func writeChatAuthorizationError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, chat.ErrChatNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat_not_found"})
	case errors.Is(err, chat.ErrNotParticipant):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not_a_participant"})
	case errors.Is(err, chat.ErrChatNotAvailable):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "chat_not_available"})
	default:
		return false
	}
	return true
}

func writeChatMessagesResult(w http.ResponseWriter, messages []chat.Message, err error) {
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"data": messages})
		return
	}
	if writeChatAuthorizationError(w, err) {
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "chat_messages_failed"})
}

func writeSendMessageResult(w http.ResponseWriter, message chat.Message, err error) {
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"data": message})
		return
	}
	if errors.Is(err, chat.ErrInvalidMessage) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_message"})
		return
	}
	if writeChatAuthorizationError(w, err) {
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "message_send_failed"})
}

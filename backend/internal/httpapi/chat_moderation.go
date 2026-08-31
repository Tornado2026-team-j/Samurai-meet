package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/moderation"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/safety"
)

// chatModerate runs the AI safety check over one decrypted message the caller
// can see. A "warn" or "block" verdict is escalated to the operator-review
// queue (reports, source="ai_auto") against that message.
func chatModerate(
	w http.ResponseWriter,
	r *http.Request,
	chats *chat.Service,
	inspector *moderation.Service,
	safetyService *safety.Service,
	userID, chatID string,
) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if inspector == nil || !inspector.Available() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "moderation_unavailable"})
		return
	}
	var input struct {
		Text      string `json:"text"`
		MessageID string `json:"message_id"`
	}
	if err := decodeJSONRequest(w, r, &input, 16*1024); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	input.MessageID = strings.TrimSpace(input.MessageID)

	target, err := chats.ResolveModerationTarget(r.Context(), userID, chatID, input.MessageID)
	if err != nil {
		writeChatError(w, err)
		return
	}

	result, err := inspector.Inspect(r.Context(), userID, input.Text)
	switch {
	case err == nil:
	case errors.Is(err, moderation.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
		return
	case errors.Is(err, moderation.ErrRateLimited):
		w.Header().Set("Retry-After", "1")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "moderation_rate_limited"})
		return
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "moderation_failed"})
		return
	}

	escalated := false
	if result.Flagged() && safetyService != nil {
		if _, flagErr := safetyService.RecordModerationFlag(r.Context(), userID, target.MessageID, result.Categories, result.Severity, time.Now()); flagErr == nil {
			escalated = true
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"categories": result.Categories,
		"severity":   result.Severity,
		"escalated":  escalated,
	}})
}

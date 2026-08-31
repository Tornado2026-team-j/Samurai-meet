package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

const (
	maxChatModerationRequestBytes = 8 * 1024
	maxChatModerationRunes        = 2000
)

type chatModerationAuthorizer interface {
	AuthorizeMessageSend(context.Context, string, string) error
}

// chatModeration accepts plaintext only for the synchronous provider call.
// It returns a deliberately small decision contract: provider categories,
// scores, model response, and user text never cross this boundary.
func chatModeration(service chatModerationAuthorizer, provider chat.ModerationProvider, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		chatID, rest, ok := chatPathParts(r.URL.Path)
		if !ok || len(rest) != 1 || rest[0] != "moderation" || service == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat_not_found"})
			return
		}
		// Authorize before decoding plaintext so a caller outside an accepted,
		// unblocked chat never forwards text to OpenAI.
		if err := service.AuthorizeMessageSend(r.Context(), claims.Subject, chatID); err != nil {
			writeChatError(w, err)
			return
		}

		var input struct {
			Text string `json:"text"`
		}
		if err := decodeJSONRequest(w, r, &input, maxChatModerationRequestBytes); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_moderation_request"})
			return
		}
		plaintext := strings.TrimSpace(input.Text)
		defer func() {
			// Go strings are immutable, so clearing references is the strongest
			// request-lifetime guarantee available without retaining plaintext.
			input.Text = ""
			plaintext = ""
		}()
		if plaintext == "" || !utf8.ValidString(plaintext) || utf8.RuneCountInString(plaintext) > maxChatModerationRunes {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_moderation_request"})
			return
		}
		if provider == nil {
			writeChatModerationDecision(w, chat.ModerationUnavailable)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		decision, err := provider.Moderate(ctx, plaintext)
		cancel()
		if err != nil || (decision != chat.ModerationAllowed && decision != chat.ModerationBlocked) {
			writeChatModerationDecision(w, chat.ModerationUnavailable)
			return
		}
		writeChatModerationDecision(w, decision)
	}
}

func writeChatModerationDecision(w http.ResponseWriter, decision chat.ModerationDecision) {
	data := map[string]string{"decision": string(decision)}
	if decision == chat.ModerationUnavailable {
		// This is safe operational state, not an upstream error body. The
		// client must fail closed and show a localized retry message.
		data["code"] = "moderation_unavailable"
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

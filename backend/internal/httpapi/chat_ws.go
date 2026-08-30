package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

const chatWebSocketPrefix = APIV1Prefix + "/ws/chats/"

// chatWebSocket upgrades GET /api/v1/ws/chats/{chat_id} to a chat delivery
// socket. The connection authenticates with a first-frame Chat Token, not the
// session middleware, so this handler only resolves the chat ID and delegates
// the lifecycle to the chat service.
func chatWebSocket(service *chat.Service, originPatterns []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_transport_unavailable"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		raw := strings.Trim(strings.TrimPrefix(r.URL.Path, chatWebSocketPrefix), "/")
		chatID, err := url.PathUnescape(raw)
		if err != nil || chatID == "" || strings.Contains(chatID, "/") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat_not_found"})
			return
		}
		service.ServeWebSocket(w, r, chatID, originPatterns)
	}
}

// originHostPatterns converts allowed client origins ("https://app.example")
// into the host[:port] patterns coder/websocket matches the Origin header
// against. Native clients send no Origin header and are unaffected.
func originHostPatterns(origins []string) []string {
	patterns := make([]string, 0, len(origins))
	for _, origin := range origins {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host == "" {
			continue
		}
		patterns = append(patterns, parsed.Host)
	}
	return patterns
}

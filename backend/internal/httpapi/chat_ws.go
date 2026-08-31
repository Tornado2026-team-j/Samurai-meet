package httpapi

import (
	"net/http"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

const chatWebSocketPrefix = APIV1Prefix + "/ws/chats/"

// chatWebSocket is retained only to return an explicit migration error. No
// WebSocket upgrade, token parsing, or fallback behavior remains.
func chatWebSocket() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusGone, map[string]string{"error": "websocket_transport_removed", "transport": chat.QUICTransport})
	}
}

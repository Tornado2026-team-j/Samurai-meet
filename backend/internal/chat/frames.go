package chat

import (
	"encoding/json"
	"errors"
)

// encodeFrame serializes a server-push WebTransport frame. It deliberately
// lives outside any transport implementation so cluster fan-out and direct
// delivery share exactly the same wire contract.
func encodeFrame(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		return []byte(`{"type":"error","code":"internal"}`)
	}
	return data
}

// transportErrorCode maps domain errors to the stable WebTransport frame
// protocol. It intentionally has no WebSocket-specific name or behavior.
func transportErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrChatInvalidInput):
		return "invalid_input"
	case errors.Is(err, ErrChatRateLimited):
		return "rate_limited"
	case errors.Is(err, ErrMessageTooLarge):
		return "message_too_large"
	case errors.Is(err, ErrChatBlocked):
		return "blocked"
	case errors.Is(err, ErrChatNotAvailable):
		return "chat_not_available"
	case errors.Is(err, ErrChatForbidden):
		return "forbidden"
	case errors.Is(err, ErrChatNotFound), errors.Is(err, ErrMessageNotFound):
		return "not_found"
	default:
		return "chat_failed"
	}
}

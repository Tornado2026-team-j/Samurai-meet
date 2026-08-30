package chat

// WebSocket delivery wire types.
//
// Every frame is a JSON object with a "type" discriminator. The transport is
// ciphertext-only, exactly like the REST API: the server never receives or
// stores a plaintext body. See docs/features/chat-transport.md.

// Client -> server frame types.
const (
	clientFrameAuth        = "auth"
	clientFrameMessageSend = "message.send"
	clientFrameMessageRead = "message.read"
	clientFrameTypingStart = "typing.start"
	clientFrameTypingStop  = "typing.stop"
	clientFramePing        = "ping"
)

// Server -> client frame types.
const (
	serverFrameAuthOK         = "auth.ok"
	serverFrameMessageCreated = "message.created"
	serverFrameMessageAck     = "message.ack"
	serverFrameMessageRead    = "message.read"
	serverFrameTyping         = "typing"
	serverFramePong           = "pong"
	serverFrameError          = "error"
	serverFrameClosing        = "closing"
)

// inboundFrame is the shared shape decoded from every client frame. Fields not
// relevant to a given type stay at their zero value.
type inboundFrame struct {
	Type                string `json:"type"`
	ChatToken           string `json:"chat_token"`
	ClientMessageID     string `json:"client_message_id"`
	Ciphertext          string `json:"ciphertext"`
	Nonce               string `json:"nonce"`
	Algorithm           string `json:"algorithm"`
	KeyVersion          string `json:"key_version"`
	LastMessageSequence int64  `json:"last_message_sequence"`
}

type authOKFrame struct {
	Type           string `json:"type"`
	ChatID         string `json:"chat_id"`
	TokenExpiresAt string `json:"token_expires_at"`
}

type messageFrame struct {
	Type    string  `json:"type"`
	Message Message `json:"message"`
}

type ackFrame struct {
	Type            string  `json:"type"`
	ClientMessageID string  `json:"client_message_id"`
	Message         Message `json:"message"`
	Duplicate       bool    `json:"duplicate"`
}

type readFrame struct {
	Type                string `json:"type"`
	UserID              string `json:"user_id"`
	LastMessageSequence int64  `json:"last_message_sequence"`
}

type typingFrame struct {
	Type   string `json:"type"`
	UserID string `json:"user_id"`
	State  string `json:"state"`
}

type errorFrame struct {
	Type              string `json:"type"`
	Code              string `json:"code"`
	Message           string `json:"message"`
	RetryAfterSeconds int    `json:"retry_after_seconds,omitempty"`
}

type closingFrame struct {
	Type   string `json:"type"`
	Reason string `json:"reason"`
}

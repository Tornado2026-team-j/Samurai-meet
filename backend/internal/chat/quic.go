package chat

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

// QUICTransport is the Chat Token transport value reserved for the HTTP/3
// WebTransport endpoint. It deliberately differs from websocket so a token
// minted for one transport cannot be replayed on the other.
const QUICTransport = "webtransport"

var (
	ErrQUICDisabled      = errors.New("webtransport endpoint is disabled")
	ErrQUICEarlyData     = errors.New("0-rtt data cannot change chat state")
	ErrQUICUnsupportedOp = errors.New("unsupported webtransport operation")
)

// QUICEndpoint contains the transport-independent security boundary for the
// future HTTP/3/WebTransport listener. It has no network listener by itself:
// wiring a concrete listener requires a WebTransport implementation and a
// TLS/UDP deployment configuration. Keeping this boundary separate prevents a
// half-configured listener from accepting tokens or state-changing frames.
//
// Expo Go does not currently provide a WebTransport client. The endpoint stays
// disabled unless ENABLE_CHAT_WEBTRANSPORT=true is set on a deployment that
// also wires a native HTTP/3 listener. No WebSocket fallback is performed.
type QUICEndpoint struct {
	service *Service
	enabled bool
}

// NewQUICEndpoint constructs the guard used by the eventual WebTransport
// listener. enabled must remain false until that listener is installed.
func NewQUICEndpoint(service *Service, enabled bool) *QUICEndpoint {
	return &QUICEndpoint{service: service, enabled: enabled}
}

func (e *QUICEndpoint) Enabled() bool { return e != nil && e.enabled }

// QUICConnection is the authenticated identity a concrete WebTransport
// session may retain. It contains no refresh token or plaintext message data.
type QUICConnection struct {
	ChatID    string
	UserID    string
	SessionID string
	TokenSeq  int64
	ExpiresAt time.Time
}

// Authenticate validates a short-lived Chat Token and re-checks both its
// backing session and the accepted match. A caller must invoke this again on
// token rotation / heartbeat before accepting another state-changing frame.
func (e *QUICEndpoint) Authenticate(ctx context.Context, chatID, token string, now time.Time) (QUICConnection, error) {
	if e == nil || !e.enabled {
		return QUICConnection{}, ErrQUICDisabled
	}
	if e.service == nil || e.service.signer == nil {
		return QUICConnection{}, ErrChatSignerMissing
	}
	claims, err := e.service.signer.VerifyChatToken(strings.TrimSpace(token), now)
	if err != nil {
		return QUICConnection{}, ErrChatForbidden
	}
	if err := validateQUICClaims(claims, chatID); err != nil {
		return QUICConnection{}, err
	}
	if err := e.service.transportTokenCurrent(ctx, claims.SessionID, claims.ChatID, claims.TokenSeq); err != nil {
		return QUICConnection{}, err
	}
	if _, err := e.service.sessionActive(ctx, claims.Subject, claims.SessionID, now); err != nil {
		return QUICConnection{}, err
	}
	access, err := e.service.loadChat(ctx, claims.Subject, chatID, false)
	if err != nil {
		return QUICConnection{}, err
	}
	if access.MatchStatus != "accepted" {
		return QUICConnection{}, ErrChatNotAvailable
	}
	return QUICConnection{ChatID: access.ChatID, UserID: claims.Subject, SessionID: claims.SessionID, TokenSeq: claims.TokenSeq, ExpiresAt: time.Unix(claims.ExpiresAt, 0)}, nil
}

func validateQUICClaims(claims auth.ChatClaims, chatID string) error {
	if strings.TrimSpace(chatID) == "" || claims.ChatID != chatID || claims.Transport != QUICTransport {
		return ErrChatForbidden
	}
	return nil
}

// HandleFrame performs only state-changing operations supported by the
// eventual WebTransport stream. Early data is rejected before parsing or
// delegating, because QUIC 0-RTT data can be replayed. SendMessage preserves
// the existing (chat, sender, client_message_id) idempotency contract.
func (e *QUICEndpoint) HandleFrame(ctx context.Context, connection QUICConnection, earlyData bool, frame inboundFrame, now time.Time) (Message, bool, error) {
	if earlyData {
		return Message{}, false, ErrQUICEarlyData
	}
	if e == nil || !e.enabled {
		return Message{}, false, ErrQUICDisabled
	}
	if e.service == nil || connection.ChatID == "" || connection.UserID == "" || connection.SessionID == "" {
		return Message{}, false, ErrChatForbidden
	}
	// Revalidate for every mutation, not only during the initial handshake.
	if _, err := e.service.sessionActive(ctx, connection.UserID, connection.SessionID, now); err != nil {
		return Message{}, false, err
	}
	if access, err := e.service.loadChat(ctx, connection.UserID, connection.ChatID, false); err != nil {
		return Message{}, false, err
	} else if access.MatchStatus != "accepted" {
		return Message{}, false, ErrChatNotAvailable
	}
	switch frame.Type {
	case clientFrameMessageSend:
		return e.service.SendMessage(ctx, connection.UserID, connection.ChatID, SendMessageInput{
			ClientMessageID: frame.ClientMessageID,
			Ciphertext:      frame.Ciphertext,
			Nonce:           frame.Nonce,
			Algorithm:       frame.Algorithm,
			KeyVersion:      frame.KeyVersion,
			ContentType:     frame.ContentType,
		}, now)
	case clientFrameMessageRead:
		if err := e.service.MarkRead(ctx, connection.UserID, connection.ChatID, frame.LastMessageSequence, now); err != nil {
			return Message{}, false, err
		}
		return Message{}, false, nil
	case clientFrameTypingStart:
		e.service.BroadcastTyping(connection.ChatID, connection.UserID, "start")
		return Message{}, false, nil
	case clientFrameTypingStop:
		e.service.BroadcastTyping(connection.ChatID, connection.UserID, "stop")
		return Message{}, false, nil
	default:
		return Message{}, false, ErrQUICUnsupportedOp
	}
}

// RevalidateConnection is used by the long-lived WebTransport session watchdog.
// A transport token is only valid while it has not expired, its issuing session
// remains active, it is still the current per-chat token generation, and the
// accepted match still permits chat. The WebTransport server closes rather than
// silently retaining a connection when any of these conditions changes.
func (e *QUICEndpoint) RevalidateConnection(ctx context.Context, connection QUICConnection, now time.Time) error {
	if e == nil || !e.enabled || e.service == nil {
		return ErrQUICDisabled
	}
	if !now.Before(connection.ExpiresAt) {
		return ErrChatForbidden
	}
	if _, err := e.service.sessionActive(ctx, connection.UserID, connection.SessionID, now); err != nil {
		return err
	}
	if err := e.service.transportTokenCurrent(ctx, connection.SessionID, connection.ChatID, connection.TokenSeq); err != nil {
		return err
	}
	access, err := e.service.loadChat(ctx, connection.UserID, connection.ChatID, false)
	if err != nil {
		return err
	}
	if access.MatchStatus != "accepted" {
		return ErrChatNotAvailable
	}
	return nil
}

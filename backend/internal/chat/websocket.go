package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

const (
	wsSendBuffer          = 64
	wsWriteTimeout        = 10 * time.Second
	wsAuthTimeout         = 5 * time.Second
	wsReadLimit           = 256 * 1024
	wsOpTimeout           = 10 * time.Second
	maxConnectionsPerUser = 4
)

// Paced with vars so integration tests can shorten them.
var (
	wsPingInterval      = 25 * time.Second
	wsHeartbeatInterval = 20 * time.Second
)

// wsConn is one authenticated WebSocket participant on a chat. All socket
// writes go through writePump; readPump is the only reader. Any goroutine can
// call stop exactly once to begin teardown; writePump then flushes what is
// queued, sends a closing frame, and closes the socket, which unblocks
// readPump.
type wsConn struct {
	chatID  string
	userID  string
	session string

	send chan []byte
	done chan struct{}
	once sync.Once

	mu     sync.Mutex
	reason string
}

func (c *wsConn) stop(reason string) {
	c.once.Do(func() {
		c.mu.Lock()
		c.reason = reason
		c.mu.Unlock()
		close(c.done)
	})
}

func (c *wsConn) stopReason() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.reason == "" {
		return "closed"
	}
	return c.reason
}

// enqueue hands payload to writePump. A consumer that cannot keep up with the
// buffer is disconnected; it recovers missed messages over REST with the
// sequence cursor.
func (c *wsConn) enqueue(payload []byte) {
	select {
	case c.send <- payload:
	case <-c.done:
	default:
		c.stop("slow_consumer")
	}
}

// ServeWebSocket upgrades r to a chat delivery socket. Authentication is a
// first-frame Chat Token handshake (never a URL query, per
// docs/features/chat-transport.md §3): the client sends
// {"type":"auth","chat_token":"…"} within wsAuthTimeout.
func (s *Service) ServeWebSocket(w http.ResponseWriter, r *http.Request, chatID string, originPatterns []string) {
	if s == nil || s.db == nil || s.signer == nil {
		http.Error(w, `{"error":"chat_transport_unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	// Drop the http.Server request deadlines before the connection is
	// hijacked; the socket is long-lived and paced by ping/heartbeat.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: originPatterns})
	if err != nil {
		return
	}
	ws.SetReadLimit(wsReadLimit)
	defer ws.CloseNow()

	authCtx, authCancel := context.WithTimeout(r.Context(), wsAuthTimeout)
	claims, access, authErr := s.authenticateWS(authCtx, ws, chatID)
	authCancel()
	if authErr != nil {
		_ = writeFrame(r.Context(), ws, errorFrame{Type: serverFrameError, Code: wsErrorCode(authErr), Message: "authentication failed"})
		_ = ws.Close(websocket.StatusPolicyViolation, "auth")
		return
	}

	conn := &wsConn{
		chatID:  access.ChatID,
		userID:  claims.Subject,
		session: claims.SessionID,
		send:    make(chan []byte, wsSendBuffer),
		done:    make(chan struct{}),
	}
	if s.hub.connectionCount(conn.chatID, conn.userID) >= maxConnectionsPerUser {
		_ = ws.Close(websocket.StatusPolicyViolation, "too_many_connections")
		return
	}
	s.hub.register(conn)
	defer s.hub.unregister(conn)

	_ = writeFrame(r.Context(), ws, authOKFrame{
		Type:           serverFrameAuthOK,
		ChatID:         conn.chatID,
		TokenExpiresAt: time.Unix(claims.ExpiresAt, 0).UTC().Format(time.RFC3339),
	})

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); s.writePump(ws, conn) }()
	go func() { defer wg.Done(); s.heartbeat(conn) }()

	s.readPump(r.Context(), ws, conn)
	conn.stop("connection_closed")
	wg.Wait()
}

func (s *Service) authenticateWS(ctx context.Context, ws *websocket.Conn, chatID string) (auth.ChatClaims, chatAccess, error) {
	typ, data, err := ws.Read(ctx)
	if err != nil {
		return auth.ChatClaims{}, chatAccess{}, ErrChatForbidden
	}
	if typ != websocket.MessageText {
		return auth.ChatClaims{}, chatAccess{}, ErrChatInvalidInput
	}
	var frame inboundFrame
	if err := json.Unmarshal(data, &frame); err != nil || frame.Type != clientFrameAuth || strings.TrimSpace(frame.ChatToken) == "" {
		return auth.ChatClaims{}, chatAccess{}, ErrChatInvalidInput
	}
	now := time.Now()
	claims, err := s.signer.VerifyChatToken(frame.ChatToken, now)
	if err != nil {
		return auth.ChatClaims{}, chatAccess{}, ErrChatForbidden
	}
	if claims.ChatID != chatID || claims.Transport != "websocket" {
		return auth.ChatClaims{}, chatAccess{}, ErrChatForbidden
	}
	if _, err := s.sessionActive(ctx, claims.Subject, claims.SessionID, now); err != nil {
		return auth.ChatClaims{}, chatAccess{}, err
	}
	access, err := s.loadChat(ctx, claims.Subject, chatID, false)
	if err != nil {
		return auth.ChatClaims{}, chatAccess{}, err
	}
	if access.MatchStatus != "accepted" {
		return auth.ChatClaims{}, chatAccess{}, ErrChatNotAvailable
	}
	return claims, access, nil
}

func (s *Service) readPump(ctx context.Context, ws *websocket.Conn, c *wsConn) {
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			c.stop("read_closed")
			return
		}
		if typ != websocket.MessageText {
			s.replyError(c, "invalid_frame", "text frames only")
			continue
		}
		var frame inboundFrame
		if err := json.Unmarshal(data, &frame); err != nil {
			s.replyError(c, "invalid_frame", "malformed json")
			continue
		}
		switch frame.Type {
		case clientFrameMessageSend:
			s.handleSend(c, frame)
		case clientFrameMessageRead:
			s.handleRead(c, frame)
		case clientFrameTypingStart:
			s.broadcastTyping(c, "start")
		case clientFrameTypingStop:
			s.broadcastTyping(c, "stop")
		case clientFramePing:
			c.enqueue(mustFrame(map[string]string{"type": serverFramePong}))
		case clientFrameAuth:
			s.replyError(c, "already_authenticated", "")
		default:
			s.replyError(c, "unknown_frame", frame.Type)
		}
	}
}

func (s *Service) writePump(ws *websocket.Conn, c *wsConn) {
	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()
	for {
		select {
		case <-c.done:
			drainQueue(ws, c)
			gctx, gcancel := context.WithTimeout(context.Background(), wsWriteTimeout)
			_ = writeFrame(gctx, ws, closingFrame{Type: serverFrameClosing, Reason: c.stopReason()})
			gcancel()
			_ = ws.Close(websocket.StatusPolicyViolation, closeReason(c.stopReason()))
			return
		case payload := <-c.send:
			if !socketWrite(ws, payload) {
				c.stop("write_error")
				return
			}
		case <-ping.C:
			pctx, pcancel := context.WithTimeout(context.Background(), wsWriteTimeout)
			err := ws.Ping(pctx)
			pcancel()
			if err != nil {
				c.stop("ping_timeout")
				return
			}
		}
	}
}

// drainQueue best-effort flushes frames already queued (an ack or an error
// frame that raced the stop) before the closing frame goes out.
func drainQueue(ws *websocket.Conn, c *wsConn) {
	for {
		select {
		case payload := <-c.send:
			if !socketWrite(ws, payload) {
				return
			}
		default:
			return
		}
	}
}

func socketWrite(ws *websocket.Conn, payload []byte) bool {
	wctx, cancel := context.WithTimeout(context.Background(), wsWriteTimeout)
	defer cancel()
	return ws.Write(wctx, websocket.MessageText, payload) == nil
}

func closeReason(reason string) string {
	if len(reason) > 120 {
		return reason[:120]
	}
	return reason
}

func (s *Service) heartbeat(c *wsConn) {
	t := time.NewTicker(wsHeartbeatInterval)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			opctx, opcancel := context.WithTimeout(context.Background(), wsOpTimeout)
			err := s.revalidateConnection(opctx, c)
			opcancel()
			if err != nil {
				c.stop(wsErrorCode(err))
				return
			}
		}
	}
}

func (s *Service) revalidateConnection(ctx context.Context, c *wsConn) error {
	if _, err := s.sessionActive(ctx, c.userID, c.session, time.Now()); err != nil {
		return err
	}
	if _, err := s.loadChat(ctx, c.userID, c.chatID, false); err != nil {
		return err
	}
	// Keep the session warm for a client that only talks over the socket.
	_, _ = s.db.ExecContext(ctx, `UPDATE sessions SET last_seen_at=$1 WHERE id=$2`, time.Now().UTC().Format(time.RFC3339Nano), c.session)
	return nil
}

func (s *Service) handleSend(c *wsConn, frame inboundFrame) {
	ctx, cancel := context.WithTimeout(context.Background(), wsOpTimeout)
	defer cancel()
	message, created, err := s.SendMessage(ctx, c.userID, c.chatID, SendMessageInput{
		ClientMessageID: frame.ClientMessageID,
		Ciphertext:      frame.Ciphertext,
		Nonce:           frame.Nonce,
		Algorithm:       frame.Algorithm,
		KeyVersion:      frame.KeyVersion,
	}, time.Now())
	if err != nil {
		s.replyError(c, wsErrorCode(err), "message rejected")
		if errors.Is(err, ErrChatNotAvailable) || errors.Is(err, ErrChatBlocked) || errors.Is(err, ErrChatClosed) || errors.Is(err, ErrChatForbidden) {
			c.stop(wsErrorCode(err))
		}
		return
	}
	// SendMessage already fanned message.created out to the other participant.
	c.enqueue(mustFrame(ackFrame{Type: serverFrameMessageAck, ClientMessageID: message.ClientMessageID, Message: message, Duplicate: !created}))
}

func (s *Service) handleRead(c *wsConn, frame inboundFrame) {
	ctx, cancel := context.WithTimeout(context.Background(), wsOpTimeout)
	defer cancel()
	if err := s.MarkRead(ctx, c.userID, c.chatID, frame.LastMessageSequence, time.Now()); err != nil {
		s.replyError(c, wsErrorCode(err), "read rejected")
		return
	}
	// MarkRead already fanned the receipt out to the other participant.
}

func (s *Service) broadcastTyping(c *wsConn, state string) {
	if s.hub == nil {
		return
	}
	s.hub.broadcastExceptUser(c.chatID, c.userID, mustFrame(typingFrame{Type: serverFrameTyping, UserID: c.userID, State: state}))
}

func (s *Service) replyError(c *wsConn, code, message string) {
	c.enqueue(mustFrame(errorFrame{Type: serverFrameError, Code: code, Message: message}))
}

func writeFrame(ctx context.Context, ws *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ws.Write(ctx, websocket.MessageText, data)
}

func mustFrame(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		return []byte(`{"type":"error","code":"internal"}`)
	}
	return data
}

func wsErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrChatInvalidInput):
		return "invalid_input"
	case errors.Is(err, ErrMessageTooLarge):
		return "message_too_large"
	case errors.Is(err, ErrChatBlocked):
		return "blocked"
	case errors.Is(err, ErrChatNotAvailable):
		return "chat_not_available"
	case errors.Is(err, ErrChatClosed):
		return "chat_closed"
	case errors.Is(err, ErrChatForbidden):
		return "forbidden"
	case errors.Is(err, ErrChatNotFound), errors.Is(err, ErrMessageNotFound):
		return "not_found"
	default:
		return "chat_failed"
	}
}

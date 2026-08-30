package integration

import (
	"context"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

func TestChatWebSocketTokenRotation(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)

	first, err := f.chatService.IssueTransportToken(ctx, f.requesterID, f.requesterSession.SessionID, f.chatID, "websocket", now)
	if err != nil {
		t.Fatalf("issue first token: %v", err)
	}
	conn := dialChat(t, ctx, f.wsURL, first.Token)
	defer conn.CloseNow()

	// A newer generation is accepted and moves the connection's expiry forward.
	second, err := f.chatService.IssueTransportToken(ctx, f.requesterID, f.requesterSession.SessionID, f.chatID, "websocket", now)
	if err != nil {
		t.Fatalf("issue second token: %v", err)
	}
	writeFrameJSON(t, ctx, conn, map[string]any{"type": "token.renew", "chat_token": second.Token})
	renewed := readFrameJSON(t, ctx, conn)
	if renewed["type"] != "token.renewed" || renewed["token_seq"].(float64) != 2 {
		t.Fatalf("token.renewed frame = %v", renewed)
	}

	// Replaying the older generation is rejected as stale, connection survives.
	writeFrameJSON(t, ctx, conn, map[string]any{"type": "token.renew", "chat_token": first.Token})
	stale := readFrameJSON(t, ctx, conn)
	if stale["type"] != "error" || stale["code"] != "stale_token" {
		t.Fatalf("stale rotation frame = %v", stale)
	}
	writeFrameJSON(t, ctx, conn, map[string]any{"type": "ping"})
	if pong := readFrameJSON(t, ctx, conn); pong["type"] != "pong" {
		t.Fatalf("connection unusable after stale rotation: %v", pong)
	}
}

func TestChatWebSocketClosesOnTokenExpiryWithoutRotation(t *testing.T) {
	prevTTL := auth.ChatTokenTTL
	auth.ChatTokenTTL = 2 * time.Second
	defer func() { auth.ChatTokenTTL = prevTTL }()
	defer chat.SetRealtimePacingForTest(150*time.Millisecond, 150*time.Millisecond)()

	ctx := context.Background()
	f := seedAcceptedChat(t, ctx, time.Now().UTC())

	// Issue the token against the current clock so schema setup time does not
	// eat the short TTL before the handshake completes.
	conn := f.dial(t, ctx, f.requesterID, f.requesterSession.SessionID, time.Now())
	defer conn.CloseNow()

	closing := readUntilClosing(t, ctx, conn)
	if closing["reason"] != "token_expired" {
		t.Fatalf("closing reason = %v, want token_expired", closing["reason"])
	}
}

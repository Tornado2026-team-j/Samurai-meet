package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

// readUntilClosing reads frames until it sees a closing frame or the deadline
// passes, returning the closing frame. Intermediate frames (a late ack, an
// error frame that precedes the close) are tolerated.
func readUntilClosing(t *testing.T, ctx context.Context, conn *websocket.Conn) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		readCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		typ, data, err := conn.Read(readCtx)
		cancel()
		if err != nil {
			t.Fatalf("read before closing frame: %v", err)
		}
		if typ != websocket.MessageText {
			continue
		}
		frame := map[string]any{}
		if err := json.Unmarshal(data, &frame); err != nil {
			t.Fatalf("frame json: %v (%s)", err, data)
		}
		if frame["type"] == "closing" {
			return frame
		}
	}
	t.Fatal("no closing frame before deadline")
	return nil
}

func TestChatWebSocketClosesOnSessionRevoke(t *testing.T) {
	defer chat.SetRealtimePacingForTest(40*time.Millisecond, 40*time.Millisecond)()
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)

	revoked := f.dial(t, ctx, f.requesterID, f.requesterSession.SessionID, now)
	defer revoked.CloseNow()
	survivor := f.dial(t, ctx, f.ownerID, f.ownerSession.SessionID, now)
	defer survivor.CloseNow()

	if err := f.sessions.RevokeOwnedSession(ctx, f.requesterID, f.requesterSession.SessionID, "integration_test", time.Now()); err != nil {
		t.Fatalf("RevokeOwnedSession: %v", err)
	}

	closing := readUntilClosing(t, ctx, revoked)
	if closing["reason"] != "forbidden" {
		t.Fatalf("closing reason = %v, want forbidden", closing["reason"])
	}

	// The other participant's session is untouched, so its socket stays up and
	// still answers a ping.
	writeFrameJSON(t, ctx, survivor, map[string]any{"type": "ping"})
	if pong := readFrameJSON(t, ctx, survivor); pong["type"] != "pong" {
		t.Fatalf("survivor socket broke after peer revoke: %v", pong)
	}
}

func TestChatWebSocketClosesOnMatchCompletion(t *testing.T) {
	defer chat.SetRealtimePacingForTest(40*time.Millisecond, 40*time.Millisecond)()
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)

	owner := f.dial(t, ctx, f.ownerID, f.ownerSession.SessionID, now)
	defer owner.CloseNow()
	requester := f.dial(t, ctx, f.requesterID, f.requesterSession.SessionID, now)
	defer requester.CloseNow()

	if _, err := f.database.ExecContext(ctx, `UPDATE matches SET status='completed',updated_at=$1 WHERE requester_user_id=$2 AND owner_user_id=$3`,
		time.Now().UTC().Format(time.RFC3339Nano), f.requesterID, f.ownerID); err != nil {
		t.Fatalf("complete match: %v", err)
	}

	for _, conn := range []*websocket.Conn{owner, requester} {
		closing := readUntilClosing(t, ctx, conn)
		if closing["reason"] != "chat_not_available" {
			t.Fatalf("closing reason = %v, want chat_not_available", closing["reason"])
		}
	}
}

func TestChatWebSocketHeartbeatKeepsSessionWarm(t *testing.T) {
	defer chat.SetRealtimePacingForTest(30*time.Millisecond, 30*time.Millisecond)()
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)

	var before string
	if err := f.database.QueryRowContext(ctx, `SELECT last_seen_at FROM sessions WHERE id=$1`, f.ownerSession.SessionID).Scan(&before); err != nil {
		t.Fatalf("read last_seen_at: %v", err)
	}

	conn := f.dial(t, ctx, f.ownerID, f.ownerSession.SessionID, now)
	defer conn.CloseNow()

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		var after string
		if err := f.database.QueryRowContext(ctx, `SELECT last_seen_at FROM sessions WHERE id=$1`, f.ownerSession.SessionID).Scan(&after); err != nil {
			t.Fatalf("read last_seen_at: %v", err)
		}
		if after > before {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("heartbeat did not advance sessions.last_seen_at")
}

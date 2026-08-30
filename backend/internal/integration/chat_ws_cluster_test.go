package integration

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
)

// TestChatWebSocketClusterFanout stands up two independent chat.Service
// instances (each with its own in-process hub) against one database and
// confirms a message sent through instance B reaches a socket on instance A via
// the PostgreSQL LISTEN/NOTIFY bridge.
func TestChatWebSocketClusterFanout(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)

	instance := func() (*chat.Service, string) {
		svc := chat.NewService(f.database, f.signer)
		if err := svc.StartClusterFanout(ctx); err != nil {
			t.Fatalf("StartClusterFanout: %v", err)
		}
		srv := httptest.NewServer(httpapi.NewRouterWithOptions(httpapi.RouterOptions{
			Environment: "test", Sessions: f.sessions, Chats: svc,
		}))
		t.Cleanup(srv.Close)
		return svc, "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws/chats/" + f.chatID
	}

	svcA, urlA := instance()
	svcB, urlB := instance()

	ownerConn := dialChat(t, ctx, urlA, chatToken(t, ctx, svcA, f.ownerID, f.ownerSession.SessionID, f.chatID, now))
	defer ownerConn.CloseNow()
	requesterConn := dialChat(t, ctx, urlB, chatToken(t, ctx, svcB, f.requesterID, f.requesterSession.SessionID, f.chatID, now))
	defer requesterConn.CloseNow()

	// requester (instance B) -> owner (instance A), crossing the NOTIFY bridge.
	writeFrameJSON(t, ctx, requesterConn, chatSendFrame("cluster-1"))
	if ack := readFrameJSON(t, ctx, requesterConn); ack["type"] != "message.ack" || ack["duplicate"] != false {
		t.Fatalf("ack = %v", ack)
	}
	created := readFrameJSON(t, ctx, ownerConn)
	if created["type"] != "message.created" {
		t.Fatalf("cross-instance created frame = %v", created)
	}
	message := created["message"].(map[string]any)
	if message["client_message_id"] != "cluster-1" || message["ciphertext"] != chatCiphertext {
		t.Fatalf("cross-instance message = %v", message)
	}
	sequence := message["sequence"].(float64)

	// read receipt owner (A) -> requester (B).
	writeFrameJSON(t, ctx, ownerConn, map[string]any{"type": "message.read", "last_message_sequence": sequence})
	receipt := readFrameJSON(t, ctx, requesterConn)
	if receipt["type"] != "message.read" || receipt["user_id"] != f.ownerID || receipt["last_message_sequence"].(float64) != sequence {
		t.Fatalf("cross-instance read receipt = %v", receipt)
	}

	// a REST send on instance A also fans out to instance B.
	if _, _, err := svcA.SendMessage(ctx, f.ownerID, f.chatID, chat.SendMessageInput{
		ClientMessageID: "cluster-rest", Ciphertext: chatCiphertext, Nonce: chatNonce,
		Algorithm: "AES-256-GCM", KeyVersion: "v1",
	}, time.Now()); err != nil {
		t.Fatalf("REST send on instance A: %v", err)
	}
	restCreated := readFrameJSON(t, ctx, requesterConn)
	if restCreated["type"] != "message.created" || restCreated["message"].(map[string]any)["client_message_id"] != "cluster-rest" {
		t.Fatalf("cross-instance REST fan-out = %v", restCreated)
	}
}

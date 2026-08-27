package chat

import (
	"testing"
	"time"
)

func newTestConn(chatID, userID string) *wsConn {
	return &wsConn{
		chatID: chatID,
		userID: userID,
		send:   make(chan []byte, wsSendBuffer),
		done:   make(chan struct{}),
	}
}

func TestHubBroadcastExceptUserSkipsSender(t *testing.T) {
	h := newHub()
	sender := newTestConn("chat-1", "alice")
	receiver := newTestConn("chat-1", "bob")
	other := newTestConn("chat-2", "carol")
	h.register(sender)
	h.register(receiver)
	h.register(other)

	h.broadcastExceptUser("chat-1", "alice", []byte("hello"))

	select {
	case got := <-receiver.send:
		if string(got) != "hello" {
			t.Fatalf("receiver payload = %q", got)
		}
	default:
		t.Fatal("receiver did not get the broadcast")
	}
	select {
	case got := <-sender.send:
		t.Fatalf("sender should have been skipped, got %q", got)
	default:
	}
	select {
	case got := <-other.send:
		t.Fatalf("other chat should not have been reached, got %q", got)
	default:
	}
}

func TestHubUnregisterDropsRoom(t *testing.T) {
	h := newHub()
	c := newTestConn("chat-1", "alice")
	h.register(c)
	if h.connectionCount("chat-1", "alice") != 1 {
		t.Fatalf("connectionCount after register = %d", h.connectionCount("chat-1", "alice"))
	}
	h.unregister(c)
	if h.connectionCount("chat-1", "alice") != 0 {
		t.Fatalf("connectionCount after unregister = %d", h.connectionCount("chat-1", "alice"))
	}
	h.mu.RLock()
	_, ok := h.rooms["chat-1"]
	h.mu.RUnlock()
	if ok {
		t.Fatal("empty room was not removed")
	}
}

func TestConnEnqueueStopsSlowConsumer(t *testing.T) {
	c := newTestConn("chat-1", "alice")
	// Fill the buffer, then one more must trip the slow-consumer stop.
	for i := 0; i < wsSendBuffer; i++ {
		c.enqueue([]byte("x"))
	}
	c.enqueue([]byte("overflow"))

	select {
	case <-c.done:
	case <-time.After(time.Second):
		t.Fatal("slow consumer was not stopped")
	}
	if c.stopReason() != "slow_consumer" {
		t.Fatalf("stop reason = %q", c.stopReason())
	}
}

func TestConnStopIsIdempotent(t *testing.T) {
	c := newTestConn("chat-1", "alice")
	c.stop("first")
	c.stop("second")
	if c.stopReason() != "first" {
		t.Fatalf("stop reason = %q, want first", c.stopReason())
	}
}

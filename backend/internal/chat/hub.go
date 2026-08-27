package chat

import "sync"

// Hub is an in-process registry of live WebSocket connections keyed by chat ID.
//
// It is deliberately single-instance: with more than one API process, a
// message sent through process A is not delivered to a socket on process B.
// The follow-up is a PostgreSQL LISTEN/NOTIFY fan-out (see
// docs/features/chat-transport.md §6); until then run chat delivery on one
// instance or accept that WebSocket clients reconcile missed messages over
// REST using the sequence cursor.
type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*wsConn]struct{}
}

func newHub() *Hub {
	return &Hub{rooms: make(map[string]map[*wsConn]struct{})}
}

func (h *Hub) register(c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[c.chatID]
	if room == nil {
		room = make(map[*wsConn]struct{})
		h.rooms[c.chatID] = room
	}
	room[c] = struct{}{}
}

func (h *Hub) unregister(c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[c.chatID]
	if room == nil {
		return
	}
	delete(room, c)
	if len(room) == 0 {
		delete(h.rooms, c.chatID)
	}
}

// connectionCount reports how many live sockets a single user holds on one
// chat. Used to cap fan-out abuse from a single Chat Token.
func (h *Hub) connectionCount(chatID, userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for c := range h.rooms[chatID] {
		if c.userID == userID {
			count++
		}
	}
	return count
}

// broadcastExceptUser delivers payload to every socket on the chat whose user
// is not exceptUserID. A socket whose buffer is full is dropped: it will
// reconcile over REST on reconnect.
func (h *Hub) broadcastExceptUser(chatID, exceptUserID string, payload []byte) {
	h.mu.RLock()
	targets := make([]*wsConn, 0, len(h.rooms[chatID]))
	for c := range h.rooms[chatID] {
		if c.userID != exceptUserID {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.enqueue(payload)
	}
}

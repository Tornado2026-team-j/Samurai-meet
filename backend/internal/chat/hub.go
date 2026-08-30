package chat

import "sync"

// Hub is an in-process registry of live WebSocket connections keyed by chat ID.
//
// It only reaches sockets on this process. Cross-instance delivery is handled
// by clusterFanout (cluster.go): a PostgreSQL LISTEN/NOTIFY bridge that
// re-delivers remote message.created / message.read / typing events to this
// hub's local sockets. See docs/features/chat-transport.md §6.
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
// is not exceptUserID. It is used for ephemeral, per-user signals such as
// typing indicators, where the sender's own devices must not echo the event.
// A socket whose buffer is full is dropped: it will reconcile over REST on
// reconnect.
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

// broadcastExcept delivers payload to every socket on the chat except the one
// that originated the action (exceptConn, which may be nil for a REST-driven
// action). Excluding a single socket rather than the whole user means the
// sender's other devices still receive durable events such as message.created
// and read receipts, which is required for multi-device consistency. A socket
// whose buffer is full is dropped: it will reconcile over REST on reconnect.
func (h *Hub) broadcastExcept(chatID string, exceptConn *wsConn, payload []byte) {
	h.mu.RLock()
	targets := make([]*wsConn, 0, len(h.rooms[chatID]))
	for c := range h.rooms[chatID] {
		if c != exceptConn {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.enqueue(payload)
	}
}

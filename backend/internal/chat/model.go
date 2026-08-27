package chat

import "time"

// Message is one stored chat message. ServerMessageID is a monotonically
// increasing sequence assigned by PostgreSQL that fixes display order,
// independent of ClientMessageID, which only exists to make retried sends
// idempotent.
type Message struct {
	ID              string     `json:"id"`
	MatchID         string     `json:"match_id"`
	SenderUserID    string     `json:"sender_user_id"`
	Body            string     `json:"body"`
	ClientMessageID string     `json:"client_message_id"`
	ServerMessageID int64      `json:"server_message_id"`
	CreatedAt       time.Time  `json:"created_at"`
	ReadAt          *time.Time `json:"read_at,omitempty"`
}

// ChatSummary is one row of the chat list: an accepted match, its other
// participant, a preview of the most recent message, and how many of the
// counterpart's messages are still unread.
type ChatSummary struct {
	MatchID     string    `json:"match_id"`
	OtherUserID string    `json:"other_user_id"`
	LastMessage *Message  `json:"last_message,omitempty"`
	UnreadCount int       `json:"unread_count"`
	UpdatedAt   time.Time `json:"updated_at"`
}

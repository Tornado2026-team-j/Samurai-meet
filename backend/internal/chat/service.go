package chat

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
)

var (
	ErrChatNotFound     = errors.New("chat not found")
	ErrNotParticipant   = errors.New("caller is not a participant of this chat")
	ErrChatNotAvailable = errors.New("chat is not available (match not accepted, or a block exists)")
	ErrInvalidMessage   = errors.New("invalid message")
)

const (
	maxMessageBodyBytes  = 4000
	defaultMessagesLimit = 50
	maxMessagesLimit     = 200
)

type Service struct {
	db       *sql.DB
	matching *matching.Service
}

func NewService(database *sql.DB, matchingService *matching.Service) *Service {
	return &Service{db: database, matching: matchingService}
}

// authorize loads the match, confirms callerUserID is one of its two
// participants, that the match is accepted, and that no block exists
// between the participants. It is called before every read or write so a
// block created after acceptance immediately closes the chat.
func (s *Service) authorize(ctx context.Context, matchID, callerUserID string) (matching.Match, string, error) {
	if s == nil || s.db == nil || s.matching == nil || strings.TrimSpace(matchID) == "" || strings.TrimSpace(callerUserID) == "" {
		return matching.Match{}, "", ErrChatNotFound
	}
	match, err := s.matching.GetMatch(ctx, matchID)
	if errors.Is(err, matching.ErrMatchNotFound) {
		return matching.Match{}, "", ErrChatNotFound
	}
	if err != nil {
		return matching.Match{}, "", err
	}
	var other string
	switch callerUserID {
	case match.OwnerUserID:
		other = match.InterestedUserID
	case match.InterestedUserID:
		other = match.OwnerUserID
	default:
		return matching.Match{}, "", ErrNotParticipant
	}
	if match.Status != matching.MatchStatusAccepted {
		return matching.Match{}, "", ErrChatNotAvailable
	}
	blocked, err := s.matching.IsBlocked(ctx, match.OwnerUserID, match.InterestedUserID)
	if err != nil {
		return matching.Match{}, "", err
	}
	if blocked {
		return matching.Match{}, "", ErrChatNotAvailable
	}
	return match, other, nil
}

// SendMessage stores a message and is idempotent on (match_id,
// sender_user_id, client_message_id): retrying the same send returns the
// original stored message rather than creating a duplicate or erroring.
func (s *Service) SendMessage(ctx context.Context, matchID, senderUserID, clientMessageID, body string, now time.Time) (Message, error) {
	body = strings.TrimSpace(body)
	clientMessageID = strings.TrimSpace(clientMessageID)
	if body == "" || len(body) > maxMessageBodyBytes || clientMessageID == "" {
		return Message{}, ErrInvalidMessage
	}
	if _, _, err := s.authorize(ctx, matchID, senderUserID); err != nil {
		return Message{}, err
	}

	var message Message
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO messages (id,match_id,sender_user_id,body,client_message_id,created_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (match_id,sender_user_id,client_message_id) DO UPDATE SET id = messages.id
		RETURNING id,match_id,sender_user_id,body,client_message_id,server_message_id,created_at`,
		newID(), matchID, senderUserID, body, clientMessageID, now.UTC().Format(time.RFC3339Nano),
	).Scan(&message.ID, &message.MatchID, &message.SenderUserID, &message.Body, &message.ClientMessageID, &message.ServerMessageID, &createdAt)
	if err != nil {
		return Message{}, err
	}
	if message.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return Message{}, err
	}
	return message, nil
}

// ListMessages returns messages for matchID with server_message_id > after,
// oldest first, for reconnect/history sync. after=0 returns from the start.
func (s *Service) ListMessages(ctx context.Context, matchID, callerUserID string, after int64, limit int) ([]Message, error) {
	if _, _, err := s.authorize(ctx, matchID, callerUserID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > maxMessagesLimit {
		limit = defaultMessagesLimit
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,match_id,sender_user_id,body,client_message_id,server_message_id,created_at,read_at
		FROM messages
		WHERE match_id=$1 AND server_message_id > $2 AND deleted_at IS NULL
		ORDER BY server_message_id ASC
		LIMIT $3`, matchID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]Message, 0)
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

// ListChats returns every accepted chat for userID with a preview of the
// most recent message and an unread count of the counterpart's messages.
func (s *Service) ListChats(ctx context.Context, userID string) ([]ChatSummary, error) {
	if s == nil || s.db == nil || s.matching == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrChatNotFound
	}
	matches, err := s.matching.ListAcceptedMatches(ctx, userID)
	if err != nil {
		return nil, err
	}

	summaries := make([]ChatSummary, 0, len(matches))
	for _, match := range matches {
		other := match.InterestedUserID
		if userID == match.InterestedUserID {
			other = match.OwnerUserID
		}
		summary := ChatSummary{MatchID: match.ID, OtherUserID: other, UpdatedAt: match.UpdatedAt}

		lastMessage, err := scanMessage(s.db.QueryRowContext(ctx, `
			SELECT id,match_id,sender_user_id,body,client_message_id,server_message_id,created_at,read_at
			FROM messages WHERE match_id=$1 AND deleted_at IS NULL
			ORDER BY server_message_id DESC LIMIT 1`, match.ID))
		if err == nil {
			summary.LastMessage = &lastMessage
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}

		var unread int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM messages
			WHERE match_id=$1 AND sender_user_id<>$2 AND read_at IS NULL AND deleted_at IS NULL`, match.ID, userID).Scan(&unread); err != nil {
			return nil, err
		}
		summary.UnreadCount = unread

		summaries = append(summaries, summary)
	}
	return summaries, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanMessage(row rowScanner) (Message, error) {
	var message Message
	var createdAt string
	var readAt sql.NullString
	err := row.Scan(&message.ID, &message.MatchID, &message.SenderUserID, &message.Body, &message.ClientMessageID, &message.ServerMessageID, &createdAt, &readAt)
	if err != nil {
		return Message{}, err
	}
	if message.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return Message{}, err
	}
	if readAt.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, readAt.String)
		if err != nil {
			return Message{}, err
		}
		message.ReadAt = &parsed
	}
	return message, nil
}

func newID() string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

package chat

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
)

var (
	ErrChatNotFound      = errors.New("chat not found")
	ErrChatForbidden     = errors.New("chat operation is forbidden")
	ErrChatBlocked       = errors.New("chat participants are blocked")
	ErrChatInvalidInput  = errors.New("invalid chat input")
	ErrChatNotAvailable  = errors.New("chat is not available for this match")
	ErrChatClosed        = errors.New("chat is closed")
	ErrMessageNotFound   = errors.New("message not found")
	ErrMessageTooLarge   = errors.New("message is too large")
	ErrChatSignerMissing = errors.New("chat token signer is not configured")
)

const (
	defaultMessageLimit = 50
	maxMessageLimit     = 100
	maxClientMessageID  = 128
	maxKeyVersion       = 64
	maxCiphertextBytes  = 128 * 1024
)

// Service persists ciphertext-only chat messages. The server never receives
// or decrypts the message body.
type Service struct {
	db            *sql.DB
	signer        *auth.Signer
	notifications *notification.Service
	hub           *Hub
}

type ChatSummary struct {
	ID            string `json:"id"`
	MatchID       string `json:"match_id"`
	Status        string `json:"status"`
	OtherUserID   string `json:"other_user_id"`
	OtherUserName string `json:"other_user_name"`
	LastMessageAt string `json:"last_message_at,omitempty"`
	UnreadCount   int    `json:"unread_count"`
	UpdatedAt     string `json:"updated_at"`
}

type Message struct {
	ID              string `json:"id"`
	ChatID          string `json:"chat_id"`
	SenderUserID    string `json:"sender_user_id"`
	ClientMessageID string `json:"client_message_id"`
	Sequence        int64  `json:"sequence"`
	Ciphertext      string `json:"ciphertext"`
	Nonce           string `json:"nonce"`
	Algorithm       string `json:"algorithm"`
	KeyVersion      string `json:"key_version"`
	CreatedAt       string `json:"created_at"`
}

type MessagePage struct {
	Items     []Message `json:"items"`
	NextAfter int64     `json:"next_after,omitempty"`
	HasMore   bool      `json:"has_more"`
}

type SendMessageInput struct {
	ClientMessageID string `json:"client_message_id"`
	Ciphertext      string `json:"ciphertext"`
	Nonce           string `json:"nonce"`
	Algorithm       string `json:"algorithm"`
	KeyVersion      string `json:"key_version"`
}

type TransportToken struct {
	Token     string    `json:"chat_token"`
	ExpiresAt time.Time `json:"expires_at"`
	Transport string    `json:"transport"`
}

type chatAccess struct {
	ChatID      string
	MatchID     string
	ChatStatus  string
	MatchStatus string
	OwnerUserID string
	RequesterID string
	OtherUserID string
}

func NewService(database *sql.DB, signer *auth.Signer, notificationServices ...*notification.Service) *Service {
	var notifications *notification.Service
	if len(notificationServices) > 0 {
		notifications = notificationServices[0]
	}
	return &Service{db: database, signer: signer, notifications: notifications, hub: newHub()}
}

// sessionActive confirms the session behind a Chat Token is still usable:
// present, active, not revoked, not past its absolute or idle expiry.
func (s *Service) sessionActive(ctx context.Context, userID, sessionID string, now time.Time) (time.Time, error) {
	if strings.TrimSpace(sessionID) == "" {
		return time.Time{}, ErrChatForbidden
	}
	var status, expires, lastSeen string
	err := s.db.QueryRowContext(ctx, `
		SELECT status,expires_at,last_seen_at FROM sessions
		WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`, sessionID, userID).Scan(&status, &expires, &lastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrChatForbidden
	}
	if err != nil {
		return time.Time{}, err
	}
	expiry, expiryErr := time.Parse(time.RFC3339Nano, expires)
	lastSeenAt, lastSeenErr := time.Parse(time.RFC3339Nano, lastSeen)
	if expiryErr != nil || lastSeenErr != nil || status != string(auth.SessionActive) ||
		!now.Before(expiry) || !now.Before(lastSeenAt.Add(auth.RefreshIdleTTL)) {
		return time.Time{}, ErrChatForbidden
	}
	return expiry, nil
}

func (s *Service) List(ctx context.Context, userID string, now time.Time) ([]ChatSummary, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrChatNotFound
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id FROM matches
		WHERE (owner_user_id=$1 OR requester_user_id=$1)
		  AND status IN ('accepted','completed')
		ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	matchIDs := make([]string, 0)
	for rows.Next() {
		var matchID string
		if err := rows.Scan(&matchID); err != nil {
			return nil, err
		}
		matchIDs = append(matchIDs, matchID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]ChatSummary, 0, len(matchIDs))
	for _, matchID := range matchIDs {
		access, err := s.ensureChat(ctx, userID, matchID, now)
		if errors.Is(err, ErrChatBlocked) || errors.Is(err, ErrChatNotFound) || errors.Is(err, ErrChatNotAvailable) {
			continue
		}
		if err != nil {
			return nil, err
		}
		summary, err := s.summary(ctx, userID, access)
		if err != nil {
			return nil, err
		}
		result = append(result, summary)
	}
	return result, nil
}

func (s *Service) ListMessages(ctx context.Context, userID, chatID string, after int64, limit int, now time.Time) (MessagePage, error) {
	if after < 0 {
		return MessagePage{}, ErrChatInvalidInput
	}
	limit = normalizeLimit(limit)
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return MessagePage{}, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,chat_id,sender_user_id,client_message_id,sequence,ciphertext,nonce,algorithm,key_version,created_at
		FROM messages
		WHERE chat_id=$1 AND sequence>$2 AND deleted_at IS NULL
		ORDER BY sequence ASC
		LIMIT $3`, access.ChatID, after, limit+1)
	if err != nil {
		return MessagePage{}, err
	}
	defer rows.Close()
	items := make([]Message, 0, limit)
	for rows.Next() {
		var item Message
		if err := rows.Scan(&item.ID, &item.ChatID, &item.SenderUserID, &item.ClientMessageID, &item.Sequence, &item.Ciphertext, &item.Nonce, &item.Algorithm, &item.KeyVersion, &item.CreatedAt); err != nil {
			return MessagePage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return MessagePage{}, err
	}
	page := MessagePage{Items: items}
	if len(items) > limit {
		page.HasMore = true
		page.Items = items[:limit]
	}
	if len(page.Items) > 0 {
		page.NextAfter = page.Items[len(page.Items)-1].Sequence
	}
	_ = now // reserved for a future chat-retention boundary
	return page, nil
}

// SendMessage stores one ciphertext message. It is idempotent on
// (chat, sender, client_message_id): a repeated client_message_id returns the
// original row with created=false. When a new row is stored, the other
// participant's live WebSocket connections receive a message.created frame.
func (s *Service) SendMessage(ctx context.Context, userID, chatID string, input SendMessageInput, now time.Time) (Message, bool, error) {
	if err := validateMessageInput(input); err != nil {
		return Message{}, false, err
	}
	access, err := s.loadChat(ctx, userID, chatID, false)
	if err != nil {
		return Message{}, false, err
	}
	if access.MatchStatus != "accepted" {
		return Message{}, false, ErrChatNotAvailable
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, false, err
	}
	defer tx.Rollback()
	id, err := randomID()
	if err != nil {
		return Message{}, false, err
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	var message Message
	isNew := true
	err = tx.QueryRowContext(ctx, `
		INSERT INTO messages (id,chat_id,sender_user_id,client_message_id,ciphertext,nonce,algorithm,key_version,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (chat_id,sender_user_id,client_message_id) DO NOTHING
		RETURNING id,chat_id,sender_user_id,client_message_id,sequence,ciphertext,nonce,algorithm,key_version,created_at`,
		id, access.ChatID, userID, input.ClientMessageID, input.Ciphertext, input.Nonce, input.Algorithm, input.KeyVersion, timestamp).Scan(
		&message.ID, &message.ChatID, &message.SenderUserID, &message.ClientMessageID, &message.Sequence,
		&message.Ciphertext, &message.Nonce, &message.Algorithm, &message.KeyVersion, &message.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		isNew = false
		if err = tx.QueryRowContext(ctx, `
			SELECT id,chat_id,sender_user_id,client_message_id,sequence,ciphertext,nonce,algorithm,key_version,created_at
			FROM messages WHERE chat_id=$1 AND sender_user_id=$2 AND client_message_id=$3`,
			access.ChatID, userID, input.ClientMessageID).Scan(
			&message.ID, &message.ChatID, &message.SenderUserID, &message.ClientMessageID, &message.Sequence,
			&message.Ciphertext, &message.Nonce, &message.Algorithm, &message.KeyVersion, &message.CreatedAt); err != nil {
			return Message{}, false, err
		}
	} else if err != nil {
		return Message{}, false, err
	} else if _, err = tx.ExecContext(ctx, `UPDATE chat_threads SET updated_at=$1 WHERE id=$2`, timestamp, access.ChatID); err != nil {
		return Message{}, false, err
	}
	if isNew && s.notifications != nil {
		actorName, nameErr := s.notificationActorNameTx(ctx, tx, userID)
		if nameErr != nil {
			return Message{}, false, nameErr
		}
		if err = s.notifications.CreateTx(ctx, tx, notification.CreateInput{
			UserID:      access.OtherUserID,
			EventKey:    "new_message:" + message.ID,
			Type:        notification.TypeNewMessage,
			TargetID:    access.ChatID,
			Destination: notification.DestinationChat,
			ActorName:   actorName,
		}, now); err != nil {
			return Message{}, false, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Message{}, false, err
	}
	if isNew && s.hub != nil {
		s.hub.broadcastExceptUser(access.ChatID, userID, mustFrame(messageFrame{Type: serverFrameMessageCreated, Message: message}))
	}
	return message, isNew, nil
}

func (s *Service) notificationActorNameTx(ctx context.Context, tx *sql.Tx, userID string) (string, error) {
	var name string
	err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(p.name,''),u.display_name,'')
		FROM users u LEFT JOIN profiles p ON p.user_id=u.id
		WHERE u.id=$1 AND u.status='active'`, userID).Scan(&name)
	return strings.TrimSpace(name), err
}

// MarkRead advances the caller's read marker for a chat. last_message_sequence
// is treated as a high-water mark, not an exact message id: the global
// BIGSERIAL `messages.sequence` is sparse within any one chat, so a client just
// echoes back the highest sequence it has seen. The value is clamped to the
// newest live message in this chat and the stored marker only ever moves
// forward. The other participant is notified with the effective stored marker.
func (s *Service) MarkRead(ctx context.Context, userID, chatID string, sequence int64, now time.Time) error {
	if sequence <= 0 {
		return ErrChatInvalidInput
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return err
	}
	var maxSequence sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT MAX(sequence) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL`, access.ChatID).Scan(&maxSequence); err != nil {
		return err
	}
	if !maxSequence.Valid {
		return ErrMessageNotFound
	}
	if sequence > maxSequence.Int64 {
		sequence = maxSequence.Int64
	}
	var stored int64
	if err = s.db.QueryRowContext(ctx, `
		INSERT INTO chat_read_states (chat_id,user_id,last_read_sequence,read_at)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (chat_id,user_id) DO UPDATE SET
			last_read_sequence=GREATEST(chat_read_states.last_read_sequence,EXCLUDED.last_read_sequence),
			read_at=EXCLUDED.read_at
		RETURNING last_read_sequence`, access.ChatID, userID, sequence, now.UTC().Format(time.RFC3339Nano)).Scan(&stored); err != nil {
		return err
	}
	if s.hub != nil {
		s.hub.broadcastExceptUser(access.ChatID, userID, mustFrame(readFrame{Type: serverFrameMessageRead, UserID: userID, LastMessageSequence: stored}))
	}
	return nil
}

func (s *Service) IssueTransportToken(ctx context.Context, userID, sessionID, chatID, transport string, now time.Time) (TransportToken, error) {
	if s == nil || s.signer == nil {
		return TransportToken{}, ErrChatSignerMissing
	}
	transport = strings.TrimSpace(transport)
	if transport == "" {
		transport = "websocket"
	}
	// Only WebSocket delivery exists today. `webtransport` / `quic` are
	// reserved for a future transport and are rejected until a server that
	// terminates them ships, so a Chat Token is never issued for a path that
	// nothing serves.
	if transport != "websocket" {
		return TransportToken{}, ErrChatInvalidInput
	}
	access, err := s.loadChat(ctx, userID, chatID, false)
	if err != nil {
		return TransportToken{}, err
	}
	if access.MatchStatus != "accepted" {
		return TransportToken{}, ErrChatNotAvailable
	}
	token, claims, err := s.signer.IssueChatToken(userID, sessionID, access.ChatID, transport, now)
	if err != nil {
		return TransportToken{}, err
	}
	return TransportToken{Token: token, ExpiresAt: time.Unix(claims.ExpiresAt, 0).UTC(), Transport: transport}, nil
}

func (s *Service) ensureChat(ctx context.Context, userID, matchID string, now time.Time) (chatAccess, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return chatAccess{}, err
	}
	defer tx.Rollback()
	var access chatAccess
	var matchStatus string
	if err = tx.QueryRowContext(ctx, `
		SELECT m.id,m.owner_user_id,m.requester_user_id,m.status
		FROM matches m WHERE m.id=$1 FOR UPDATE`, matchID).Scan(
		&access.MatchID, &access.OwnerUserID, &access.RequesterID, &matchStatus); errors.Is(err, sql.ErrNoRows) {
		return chatAccess{}, ErrChatNotFound
	} else if err != nil {
		return chatAccess{}, err
	}
	access.MatchStatus = matchStatus
	if userID != access.OwnerUserID && userID != access.RequesterID {
		return chatAccess{}, ErrChatForbidden
	}
	if matchStatus != "accepted" && matchStatus != "completed" {
		return chatAccess{}, ErrChatNotAvailable
	}
	blocked, err := blockedTx(ctx, tx, access.OwnerUserID, access.RequesterID)
	if err != nil {
		return chatAccess{}, err
	}
	if blocked {
		return chatAccess{}, ErrChatBlocked
	}
	access.OtherUserID = access.OwnerUserID
	if userID == access.OwnerUserID {
		access.OtherUserID = access.RequesterID
	}
	var existingStatus string
	err = tx.QueryRowContext(ctx, `SELECT id,status FROM chat_threads WHERE match_id=$1 FOR UPDATE`, matchID).Scan(&access.ChatID, &existingStatus)
	if errors.Is(err, sql.ErrNoRows) {
		access.ChatID, err = randomID()
		if err != nil {
			return chatAccess{}, err
		}
		created := now.UTC().Format(time.RFC3339Nano)
		if _, err = tx.ExecContext(ctx, `INSERT INTO chat_threads (id,match_id,status,created_at,updated_at) VALUES ($1,$2,'open',$3,$3)`, access.ChatID, matchID, created); err != nil {
			return chatAccess{}, err
		}
		existingStatus = "open"
	} else if err != nil {
		return chatAccess{}, err
	}
	access.ChatStatus = existingStatus
	if err = tx.Commit(); err != nil {
		return chatAccess{}, err
	}
	return access, nil
}

func (s *Service) loadChat(ctx context.Context, userID, chatID string, allowCompleted bool) (chatAccess, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(chatID) == "" {
		return chatAccess{}, ErrChatNotFound
	}
	var access chatAccess
	if err := s.db.QueryRowContext(ctx, `
		SELECT c.id,c.match_id,c.status,m.status,m.owner_user_id,m.requester_user_id
		FROM chat_threads c JOIN matches m ON m.id=c.match_id
		WHERE c.id=$1`, chatID).Scan(
		&access.ChatID, &access.MatchID, &access.ChatStatus, &access.MatchStatus, &access.OwnerUserID, &access.RequesterID); errors.Is(err, sql.ErrNoRows) {
		return chatAccess{}, ErrChatNotFound
	} else if err != nil {
		return chatAccess{}, err
	}
	if userID != access.OwnerUserID && userID != access.RequesterID {
		return chatAccess{}, ErrChatForbidden
	}
	if access.MatchStatus != "accepted" && (!allowCompleted || access.MatchStatus != "completed") {
		return chatAccess{}, ErrChatNotAvailable
	}
	blocked, err := s.blocked(ctx, access.OwnerUserID, access.RequesterID)
	if err != nil {
		return chatAccess{}, err
	}
	if blocked {
		return chatAccess{}, ErrChatBlocked
	}
	if userID == access.OwnerUserID {
		access.OtherUserID = access.RequesterID
	} else {
		access.OtherUserID = access.OwnerUserID
	}
	if access.ChatStatus != "open" && !allowCompleted {
		return chatAccess{}, ErrChatClosed
	}
	return access, nil
}

func (s *Service) summary(ctx context.Context, userID string, access chatAccess) (ChatSummary, error) {
	var result ChatSummary
	result.ID, result.MatchID, result.Status, result.OtherUserID = access.ChatID, access.MatchID, access.MatchStatus, access.OtherUserID
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(p.name,''),u.display_name,''),c.updated_at
		FROM chat_threads c JOIN users u ON u.id=$2
		LEFT JOIN profiles p ON p.user_id=u.id
		WHERE c.id=$1`, access.ChatID, access.OtherUserID).Scan(&result.OtherUserName, &result.UpdatedAt); err != nil {
		return ChatSummary{}, err
	}
	var lastAt sql.NullString
	if err := s.db.QueryRowContext(ctx, `SELECT MAX(created_at) FROM messages WHERE chat_id=$1 AND deleted_at IS NULL`, access.ChatID).Scan(&lastAt); err != nil {
		return ChatSummary{}, err
	}
	if lastAt.Valid {
		result.LastMessageAt = lastAt.String
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM messages m
		LEFT JOIN chat_read_states r ON r.chat_id=m.chat_id AND r.user_id=$2
		WHERE m.chat_id=$1 AND m.sender_user_id<>$2 AND m.deleted_at IS NULL
		  AND m.sequence>COALESCE(r.last_read_sequence,0)`, access.ChatID, userID).Scan(&result.UnreadCount); err != nil {
		return ChatSummary{}, err
	}
	return result, nil
}

func (s *Service) blocked(ctx context.Context, first, second string) (bool, error) {
	var blocked bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1))`, first, second).Scan(&blocked)
	return blocked, err
}

func blockedTx(ctx context.Context, tx *sql.Tx, first, second string) (bool, error) {
	var blocked bool
	err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1))`, first, second).Scan(&blocked)
	return blocked, err
}

func validateMessageInput(input SendMessageInput) error {
	input.Ciphertext = strings.TrimSpace(input.Ciphertext)
	input.Nonce = strings.TrimSpace(input.Nonce)
	input.Algorithm = strings.TrimSpace(input.Algorithm)
	if !validIdentifier(input.ClientMessageID, maxClientMessageID) ||
		!validIdentifier(input.KeyVersion, maxKeyVersion) || input.Algorithm != "AES-256-GCM" {
		return ErrChatInvalidInput
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(input.Ciphertext)
	if err != nil || len(ciphertext) < 16 {
		return ErrChatInvalidInput
	}
	if len(ciphertext) > maxCiphertextBytes {
		return ErrMessageTooLarge
	}
	nonce, err := base64.RawURLEncoding.DecodeString(input.Nonce)
	if err != nil || len(nonce) != 12 {
		return ErrChatInvalidInput
	}
	return nil
}

func normalizeLimit(value int) int {
	if value <= 0 {
		return defaultMessageLimit
	}
	if value > maxMessageLimit {
		return maxMessageLimit
	}
	return value
}

func validIdentifier(value string, maxRunes int) bool {
	if value == "" || !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxRunes {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

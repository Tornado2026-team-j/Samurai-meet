package chat

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

// The in-process Hub only reaches sockets on the same API process. With more
// than one instance, a message sent through process A is invisible to a socket
// on process B. clusterFanout closes that gap with PostgreSQL LISTEN/NOTIFY:
// every durable fan-out (message.created, message.read) and typing signal is
// also announced on a NOTIFY channel; each instance's listener rebuilds the
// frame and delivers it to its own local sockets, skipping events it published
// itself so local sockets are not served twice.
//
// The NOTIFY payload stays tiny (well under Postgres' 8000-byte limit): for a
// new message it carries only the sequence, and the listener re-reads the
// ciphertext row from the database.

var schemaIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type clusterEvent struct {
	Instance string `json:"instance"`
	Kind     string `json:"kind"`
	ChatID   string `json:"chat_id"`
	Sequence int64  `json:"sequence,omitempty"`
	UserID   string `json:"user_id,omitempty"`
	State    string `json:"state,omitempty"`
}

func newInstanceID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("inst-%d", time.Now().UnixNano())
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// StartClusterFanout wires this Service into the cross-instance NOTIFY channel
// and starts a background listener that re-delivers remote events to local
// sockets. It returns once the listener has issued its first LISTEN (so a
// caller can rely on not missing events published right after startup); the
// listener then runs and reconnects until ctx is cancelled. Calling it also
// enables publishing, so a single-instance deployment can leave it off with no
// NOTIFY traffic.
func (s *Service) StartClusterFanout(ctx context.Context) error {
	if s == nil || s.db == nil {
		return errors.New("chat service is not configured")
	}
	var schema string
	if err := s.db.QueryRowContext(ctx, `SELECT current_schema()`).Scan(&schema); err != nil {
		return fmt.Errorf("resolve current schema: %w", err)
	}
	channel := "chat_events"
	if schema != "" && schema != "public" && schemaIdentifier.MatchString(schema) {
		// Keep test schemas (and any non-default deployment schema) from
		// cross-talking on one shared channel.
		channel = "chat_events_" + schema
	}
	s.clusterCh = channel
	s.clusterEnabled = true

	ready := make(chan error, 1)
	go s.runClusterListener(ctx, ready)
	select {
	case err := <-ready:
		return err
	case <-time.After(10 * time.Second):
		return errors.New("chat cluster listener did not become ready")
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) runClusterListener(ctx context.Context, ready chan<- error) {
	var once sync.Once
	signal := func(err error) { once.Do(func() { ready <- err }) }

	backoff := time.Second
	for ctx.Err() == nil {
		err := s.listenOnce(ctx, func() { signal(nil) })
		if ctx.Err() != nil {
			return
		}
		signal(err) // no-op if the first LISTEN already succeeded
		if s.clusterLogf != nil && err != nil {
			s.clusterLogf("chat cluster listener dropped: %v (retrying in %s)", err, backoff)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (s *Service) listenOnce(ctx context.Context, onReady func()) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	return conn.Raw(func(driverConn any) error {
		stdConn, ok := driverConn.(*stdlib.Conn)
		if !ok {
			return fmt.Errorf("unexpected driver connection type %T", driverConn)
		}
		pconn := stdConn.Conn()
		if _, err := pconn.Exec(ctx, "LISTEN "+pgx.Identifier{s.clusterCh}.Sanitize()); err != nil {
			return err
		}
		onReady()
		for {
			notification, err := pconn.WaitForNotification(ctx)
			if err != nil {
				return err
			}
			if notification != nil {
				s.handleClusterNotification(notification.Payload)
			}
		}
	})
}

func (s *Service) publishClusterEvent(event clusterEvent) {
	if s == nil || !s.clusterEnabled || s.db == nil {
		return
	}
	event.Instance = s.instanceID
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := s.db.ExecContext(ctx, `SELECT pg_notify($1,$2)`, s.clusterCh, string(payload)); err != nil && s.clusterLogf != nil {
		// A missed NOTIFY only costs remote sockets a REST reconcile on
		// reconnect, so this is best-effort.
		s.clusterLogf("chat cluster publish failed: %v", err)
	}
}

func (s *Service) handleClusterNotification(payload string) {
	var event clusterEvent
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return
	}
	if event.Instance == s.instanceID || s.hub == nil {
		// Local sockets were already served directly.
		return
	}
	switch event.Kind {
	case serverFrameMessageCreated:
		message, err := s.loadMessageBySequence(event.ChatID, event.Sequence)
		if err != nil {
			return
		}
		s.hub.broadcastExcept(event.ChatID, nil, mustFrame(messageFrame{Type: serverFrameMessageCreated, Message: message}))
	case serverFrameMessageRead:
		s.hub.broadcastExcept(event.ChatID, nil, mustFrame(readFrame{Type: serverFrameMessageRead, UserID: event.UserID, LastMessageSequence: event.Sequence}))
	case serverFrameTyping:
		s.hub.broadcastExceptUser(event.ChatID, event.UserID, mustFrame(typingFrame{Type: serverFrameTyping, UserID: event.UserID, State: event.State}))
	}
}

func (s *Service) loadMessageBySequence(chatID string, sequence int64) (Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var message Message
	err := s.db.QueryRowContext(ctx, `
		SELECT id,chat_id,sender_user_id,client_message_id,sequence,ciphertext,nonce,algorithm,key_version,content_type,COALESCE(expires_at,''),created_at
		FROM messages WHERE chat_id=$1 AND sequence=$2 AND deleted_at IS NULL`, chatID, sequence).Scan(
		&message.ID, &message.ChatID, &message.SenderUserID, &message.ClientMessageID, &message.Sequence,
		&message.Ciphertext, &message.Nonce, &message.Algorithm, &message.KeyVersion, &message.ContentType, &message.ExpiresAt, &message.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrMessageNotFound
	}
	if err != nil {
		return Message{}, err
	}
	// Match the local fan-out and REST history: a photo message carries its
	// attachment metadata so a socket on another instance renders it without a
	// REST refetch.
	attachment, aErr := s.attachmentByMessageID(ctx, message.ID)
	if aErr != nil {
		return Message{}, aErr
	}
	message.Attachment = attachment
	return message, nil
}

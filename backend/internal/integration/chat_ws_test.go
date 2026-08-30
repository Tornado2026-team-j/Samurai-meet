package integration

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
)

func TestChatWebSocketDelivery(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)

	ownerID := randomID(t)
	requesterID := randomID(t)
	for _, u := range []struct{ id, google string }{
		{ownerID, "ws-owner-" + ownerID},
		{requesterID, "ws-requester-" + requesterID},
	} {
		if _, err := database.ExecContext(ctx, `
			INSERT INTO users (id,google_subject_id,display_name,status,created_at,updated_at)
			VALUES ($1,$2,$3,'active',$4,$4)`, u.id, u.google, "User "+u.id[:6], stamp); err != nil {
			t.Fatal(err)
		}
	}

	cardID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,visibility_radius_km,status,expires_at,created_at,updated_at)
		VALUES ($1,$2,'Food','2026-08-27','18:00','20:00','Asia/Tokyo',3,'matched',$3,$4,$4)`,
		cardID, ownerID, now.Add(24*time.Hour).Format(time.RFC3339Nano), stamp); err != nil {
		t.Fatal(err)
	}
	matchID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at)
		VALUES ($1,$2,$3,$4,'accepted',$5,$5,$5)`, matchID, cardID, requesterID, ownerID, stamp); err != nil {
		t.Fatal(err)
	}

	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x51}, 32)), "chat-ws-issuer", "chat-ws-audience")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionService(database, signer)
	chatService := chat.NewService(database, signer)

	ownerSession, err := sessions.CreateSession(ctx, ownerID, now)
	if err != nil {
		t.Fatal(err)
	}
	requesterSession, err := sessions.CreateSession(ctx, requesterID, now)
	if err != nil {
		t.Fatal(err)
	}

	summaries, err := chatService.List(ctx, ownerID, now)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("chat summaries = %d, want 1", len(summaries))
	}
	chatID := summaries[0].ID

	srv := httptest.NewServer(httpapi.NewRouterWithOptions(httpapi.RouterOptions{
		Environment: "test",
		Sessions:    sessions,
		Chats:       chatService,
	}))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws/chats/" + chatID

	ownerConn := dialChat(t, ctx, wsURL, chatToken(t, ctx, chatService, ownerID, ownerSession.SessionID, chatID, now))
	defer ownerConn.CloseNow()
	requesterConn := dialChat(t, ctx, wsURL, chatToken(t, ctx, chatService, requesterID, requesterSession.SessionID, chatID, now))
	defer requesterConn.CloseNow()

	// requester -> owner
	ciphertext := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 48))
	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{9}, 12))
	writeFrameJSON(t, ctx, requesterConn, map[string]any{
		"type": "message.send", "client_message_id": "cmid-1",
		"ciphertext": ciphertext, "nonce": nonce, "algorithm": "AES-256-GCM", "key_version": "v1",
	})

	ack := readFrameJSON(t, ctx, requesterConn)
	if ack["type"] != "message.ack" || ack["duplicate"] != false {
		t.Fatalf("ack frame = %v", ack)
	}
	created := readFrameJSON(t, ctx, ownerConn)
	if created["type"] != "message.created" {
		t.Fatalf("created frame = %v", created)
	}
	message := created["message"].(map[string]any)
	if message["ciphertext"] != ciphertext {
		t.Fatalf("delivered ciphertext = %v", message["ciphertext"])
	}
	sequence := message["sequence"].(float64)

	// owner reads -> requester gets the receipt
	writeFrameJSON(t, ctx, ownerConn, map[string]any{"type": "message.read", "last_message_sequence": sequence})
	receipt := readFrameJSON(t, ctx, requesterConn)
	if receipt["type"] != "message.read" || receipt["user_id"] != ownerID || receipt["last_message_sequence"].(float64) != sequence {
		t.Fatalf("read receipt = %v", receipt)
	}

	// duplicate client_message_id is idempotent, no second delivery
	writeFrameJSON(t, ctx, requesterConn, map[string]any{
		"type": "message.send", "client_message_id": "cmid-1",
		"ciphertext": ciphertext, "nonce": nonce, "algorithm": "AES-256-GCM", "key_version": "v1",
	})
	dup := readFrameJSON(t, ctx, requesterConn)
	if dup["type"] != "message.ack" || dup["duplicate"] != true {
		t.Fatalf("duplicate ack = %v", dup)
	}

	// a block cuts delivery off
	if _, err := database.ExecContext(ctx, `INSERT INTO blocks (blocker_user_id,blocked_user_id,created_at) VALUES ($1,$2,$3)`, ownerID, requesterID, stamp); err != nil {
		t.Fatal(err)
	}
	writeFrameJSON(t, ctx, requesterConn, map[string]any{
		"type": "message.send", "client_message_id": "cmid-2",
		"ciphertext": ciphertext, "nonce": nonce, "algorithm": "AES-256-GCM", "key_version": "v1",
	})
	blockedErr := readFrameJSON(t, ctx, requesterConn)
	if blockedErr["type"] != "error" || blockedErr["code"] != "blocked" {
		t.Fatalf("blocked error frame = %v", blockedErr)
	}
	closing := readFrameJSON(t, ctx, requesterConn)
	if closing["type"] != "closing" || closing["reason"] != "blocked" {
		t.Fatalf("closing frame = %v", closing)
	}
}

func chatToken(t *testing.T, ctx context.Context, service *chat.Service, userID, sessionID, chatID string, now time.Time) string {
	t.Helper()
	token, err := service.IssueTransportToken(ctx, userID, sessionID, chatID, "websocket", now)
	if err != nil {
		t.Fatalf("IssueTransportToken() error = %v", err)
	}
	return token.Token
}

func dialChat(t *testing.T, ctx context.Context, url, token string) *websocket.Conn {
	t.Helper()
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(dialCtx, url, nil)
	if err != nil {
		t.Fatalf("Dial() error = %v", err)
	}
	writeFrameJSON(t, ctx, conn, map[string]any{"type": "auth", "chat_token": token})
	authOK := readFrameJSON(t, ctx, conn)
	if authOK["type"] != "auth.ok" {
		t.Fatalf("auth response = %v", authOK)
	}
	return conn
}

func writeFrameJSON(t *testing.T, ctx context.Context, conn *websocket.Conn, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	writeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := conn.Write(writeCtx, websocket.MessageText, data); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
}

func readFrameJSON(t *testing.T, ctx context.Context, conn *websocket.Conn) map[string]any {
	t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	typ, data, err := conn.Read(readCtx)
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("frame type = %v", typ)
	}
	var frame map[string]any
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatalf("frame json error = %v (%s)", err, data)
	}
	return frame
}

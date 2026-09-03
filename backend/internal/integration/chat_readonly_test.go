package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

func readonlyChatInput(clientMessageID string) chat.SendMessageInput {
	return chat.SendMessageInput{
		ClientMessageID: clientMessageID,
		Ciphertext:      chatCiphertext,
		Nonce:           chatNonce,
		Algorithm:       "AES-256-GCM",
		KeyVersion:      "v1",
	}
}

// TestChatReadOnlyAfterRecruitmentGrace locks the "case ended, then read-only
// after a grace window" contract: an accepted chat stops accepting new
// messages and realtime tokens once the recruitment's scheduled end
// (recruitment_cards.expires_at) plus the read-only grace has passed, while
// history and read receipts keep working and the chat lists as completed.
func TestChatReadOnlyAfterRecruitmentGrace(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now) // expires_at = now+24h, default grace 48h

	// --- within the writable window ---
	firstMsg, _, err := f.chatService.SendMessage(ctx, f.requesterID, f.chatID, readonlyChatInput("open-1"), now)
	if err != nil {
		t.Fatalf("SendMessage within window error = %v", err)
	}
	if _, err := f.chatService.IssueTransportToken(ctx, f.ownerID, f.ownerSession.SessionID, f.chatID, "webtransport", now); err != nil {
		t.Fatalf("IssueTransportToken within window error = %v", err)
	}
	if summaries, err := f.chatService.List(ctx, f.ownerID, now); err != nil || len(summaries) != 1 || summaries[0].Status != "accepted" {
		t.Fatalf("List within window = %+v, %v; want one chat with status accepted", summaries, err)
	}

	// --- move the recruitment's scheduled end past the 48h grace ---
	pastEnd := now.Add(-49 * time.Hour).Format(time.RFC3339Nano)
	if _, err := f.database.ExecContext(ctx, `UPDATE recruitment_cards SET expires_at=$1 WHERE id=$2`, pastEnd, f.cardID); err != nil {
		t.Fatalf("update recruitment expiry error = %v", err)
	}

	// send and realtime token are refused
	if _, _, err := f.chatService.SendMessage(ctx, f.requesterID, f.chatID, readonlyChatInput("closed-1"), now); !errors.Is(err, chat.ErrChatNotAvailable) {
		t.Fatalf("SendMessage past grace error = %v, want ErrChatNotAvailable", err)
	}
	if _, err := f.chatService.IssueTransportToken(ctx, f.ownerID, f.ownerSession.SessionID, f.chatID, "webtransport", now); !errors.Is(err, chat.ErrChatNotAvailable) {
		t.Fatalf("IssueTransportToken past grace error = %v, want ErrChatNotAvailable", err)
	}

	// history and read receipts still work
	page, err := f.chatService.ListMessages(ctx, f.ownerID, f.chatID, 0, 50, now)
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("ListMessages past grace = %+v, %v; want the one earlier message", page, err)
	}
	if err := f.chatService.MarkRead(ctx, f.ownerID, f.chatID, firstMsg.Sequence, now); err != nil {
		t.Fatalf("MarkRead past grace error = %v", err)
	}

	// the chat now lists as completed so the two-state client UI shows read-only
	summaries, err := f.chatService.List(ctx, f.ownerID, now)
	if err != nil || len(summaries) != 1 || summaries[0].Status != "completed" {
		t.Fatalf("List past grace = %+v, %v; want one chat with status completed", summaries, err)
	}
}

// TestChatReadOnlyClosesLiveWebTransport verifies the session watchdog path:
// RevalidateConnection fails once an open connection's chat passes its
// read-only window, so the WebTransport server closes it rather than letting it
// keep sending.
func TestChatReadOnlyClosesLiveWebTransport(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	f := seedAcceptedChat(t, ctx, now)
	f.chatService.ConfigureReadOnlyGrace(0) // read-only exactly at the scheduled end

	// scheduled end a few seconds out: writable now, closed shortly after
	end := now.Add(5 * time.Second)
	if _, err := f.database.ExecContext(ctx, `UPDATE recruitment_cards SET expires_at=$1 WHERE id=$2`, end.Format(time.RFC3339Nano), f.cardID); err != nil {
		t.Fatalf("update recruitment expiry error = %v", err)
	}

	token, err := f.chatService.IssueTransportToken(ctx, f.ownerID, f.ownerSession.SessionID, f.chatID, "webtransport", now)
	if err != nil {
		t.Fatalf("IssueTransportToken error = %v", err)
	}
	endpoint := chat.NewQUICEndpoint(f.chatService, true)
	conn, err := endpoint.Authenticate(ctx, f.chatID, token.Token, now)
	if err != nil {
		t.Fatalf("Authenticate error = %v", err)
	}

	if err := endpoint.RevalidateConnection(ctx, conn, now.Add(2*time.Second)); err != nil {
		t.Fatalf("RevalidateConnection before scheduled end error = %v, want nil", err)
	}
	if err := endpoint.RevalidateConnection(ctx, conn, now.Add(10*time.Second)); !errors.Is(err, chat.ErrChatNotAvailable) {
		t.Fatalf("RevalidateConnection after scheduled end error = %v, want ErrChatNotAvailable", err)
	}
}

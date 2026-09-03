// Command devchatwt is a dev-only WebTransport chat client used to verify
// realtime delivery end to end against a locally running backend that has
// ENABLE_CHAT_WEBTRANSPORT=true. It connects two sessions (owner + requester),
// has the requester send one message over a bidi stream, and asserts the owner
// receives the matching message.created frame on a server-pushed uni stream.
//
//	go run ./cmd/devchatwt -addr 127.0.0.1:8443 -chat <chatID> \
//	  -owner <ownerChatToken> -requester <requesterChatToken>
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/webtransport-go"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8443", "WebTransport UDP host:port")
	chatID := flag.String("chat", "", "chat id")
	ownerToken := flag.String("owner", "", "owner chat_token (transport=webtransport)")
	requesterToken := flag.String("requester", "", "requester chat_token (transport=webtransport)")
	flag.Parse()
	if *chatID == "" || *ownerToken == "" || *requesterToken == "" {
		log.Fatal("-chat, -owner and -requester are required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	url := fmt.Sprintf("https://%s/api/v1/wt/chats/%s", *addr, *chatID)

	ownerSession := dial(ctx, url, *ownerToken, "owner")
	defer ownerSession.CloseWithError(0, "done")
	requesterSession := dial(ctx, url, *requesterToken, "requester")
	defer requesterSession.CloseWithError(0, "done")

	received := make(chan map[string]any, 1)
	go func() {
		stream, err := ownerSession.AcceptUniStream(ctx)
		if err != nil {
			log.Printf("[owner] AcceptUniStream: %v", err)
			return
		}
		data, err := io.ReadAll(io.LimitReader(stream, 256*1024))
		if err != nil {
			log.Printf("[owner] read uni stream: %v", err)
			return
		}
		var frame map[string]any
		if err := json.Unmarshal(data, &frame); err != nil {
			log.Printf("[owner] decode frame: %v (%s)", err, string(data))
			return
		}
		received <- frame
	}()

	// Give the owner's receive goroutine a moment to arm.
	time.Sleep(500 * time.Millisecond)

	clientMessageID := fmt.Sprintf("wt-smoke-%d", time.Now().UnixNano())
	send := map[string]any{
		"type":              "message.send",
		"client_message_id": clientMessageID,
		"ciphertext":        "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH",
		"nonce":             "CQkJCQkJCQkJCQkJ",
		"algorithm":         "AES-256-GCM",
		"key_version":       "chat-mvp-v1",
	}
	stream, err := requesterSession.OpenStream()
	if err != nil {
		log.Fatalf("[requester] OpenStream: %v", err)
	}
	if err := json.NewEncoder(stream).Encode(send); err != nil {
		log.Fatalf("[requester] write frame: %v", err)
	}
	_ = stream.Close()

	var ack map[string]any
	if err := json.NewDecoder(io.LimitReader(stream, 256*1024)).Decode(&ack); err != nil {
		log.Fatalf("[requester] read ack: %v", err)
	}
	fmt.Printf("[requester] <- %v (seq %v)\n", ack["type"], seq(ack["message"]))

	select {
	case frame := <-received:
		fmt.Printf("[owner]     <- %v (seq %v, client_message_id %v)\n",
			frame["type"], seq(frame["message"]), msgField(frame["message"], "client_message_id"))
		if frame["type"] != "message.created" {
			log.Fatalf("owner got %v, want message.created", frame["type"])
		}
		if got := msgField(frame["message"], "client_message_id"); got != clientMessageID {
			log.Fatalf("owner got client_message_id %q, want %q", got, clientMessageID)
		}
		fmt.Println("\nRESULT: realtime WebTransport delivery -> PASS")
	case <-ctx.Done():
		log.Fatal("RESULT: owner never received the realtime message -> FAIL")
	}
}

func dial(ctx context.Context, url, token, label string) *webtransport.Session {
	tr := &webtransport.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}},
		QUICConfig:      &quic.Config{EnableDatagrams: true, EnableStreamResetPartialDelivery: true},
	}
	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer "+token)
	resp, session, err := tr.Dial(ctx, url, hdr)
	if err != nil {
		log.Fatalf("[%s] dial: %v", label, err)
	}
	fmt.Printf("[%s] connected (HTTP %d)\n", label, resp.StatusCode)
	return session
}

func seq(message any) any { return msgField(message, "sequence") }
func msgField(message any, key string) any {
	if m, ok := message.(map[string]any); ok {
		return m[key]
	}
	return nil
}

package chat

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

func TestQUICEndpointFailsClosedUntilAListenerIsInstalled(t *testing.T) {
	endpoint := NewQUICEndpoint(nil, false)
	if _, err := endpoint.Authenticate(t.Context(), "chat-1", "token", time.Now()); !errors.Is(err, ErrQUICDisabled) {
		t.Fatalf("Authenticate error = %v, want disabled", err)
	}
}

func TestWebTransportRejectsQueryTokenWithoutEchoingIt(t *testing.T) {
	server := &WebTransportServer{}
	req := httptest.NewRequest(http.MethodConnect, "/api/v1/wt/chats/chat-1?chat_token=secret-token", nil)
	recorder := httptest.NewRecorder()
	server.handleConnect(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if strings.Contains(recorder.Body.String(), "secret-token") {
		t.Fatal("query token was reflected in response")
	}
}

func TestWebTransportOriginBoundary(t *testing.T) {
	allowed := originAllowed([]string{"https://app.example"})
	for _, test := range []struct {
		origin string
		want   bool
	}{{"https://app.example", true}, {"https://evil.example", false}, {"", true}} {
		req := httptest.NewRequest(http.MethodConnect, "https://api.example/api/v1/wt/chats/chat-1", nil)
		if test.origin != "" {
			req.Header.Set("Origin", test.origin)
		}
		if got := allowed(req); got != test.want {
			t.Fatalf("origin %q accepted=%v, want %v", test.origin, got, test.want)
		}
	}
}

func TestQUICRejectsEarlyDataBeforeAnyMutation(t *testing.T) {
	endpoint := NewQUICEndpoint(nil, false)
	_, _, err := endpoint.HandleFrame(t.Context(), QUICConnection{}, true, inboundFrame{Type: clientFrameMessageSend}, time.Now())
	if !errors.Is(err, ErrQUICEarlyData) {
		t.Fatalf("HandleFrame error = %v, want 0-RTT rejection", err)
	}
}

func TestValidateQUICClaimsBindsTransportAndChat(t *testing.T) {
	key := base64.RawURLEncoding.EncodeToString([]byte("01234567890123456789012345678901"))
	signer, err := auth.NewSigner(key, "issuer", "audience")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC)
	_, claims, err := signer.IssueChatToken("user-1", "session-1", "chat-1", QUICTransport, 1, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateQUICClaims(claims, "chat-1"); err != nil {
		t.Fatalf("valid WebTransport claims rejected: %v", err)
	}
	claims.Transport = "websocket"
	if err := validateQUICClaims(claims, "chat-1"); !errors.Is(err, ErrChatForbidden) {
		t.Fatalf("wrong transport error = %v", err)
	}
	claims.Transport = QUICTransport
	if err := validateQUICClaims(claims, "another-chat"); !errors.Is(err, ErrChatForbidden) {
		t.Fatalf("wrong chat error = %v", err)
	}
}

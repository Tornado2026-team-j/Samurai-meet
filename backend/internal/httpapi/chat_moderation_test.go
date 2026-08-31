package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

type chatModerationAuthorizerStub struct {
	calls int
	err   error
}

func (s *chatModerationAuthorizerStub) AuthorizeMessageSend(context.Context, string, string) error {
	s.calls++
	return s.err
}

type chatModerationProviderStub struct {
	calls    int
	decision chat.ModerationDecision
	err      error
}

func (s *chatModerationProviderStub) Moderate(_ context.Context, plaintext string) (chat.ModerationDecision, error) {
	s.calls++
	if plaintext == "" {
		return chat.ModerationUnavailable, errors.New("empty plaintext")
	}
	return s.decision, s.err
}

func TestChatModerationRequiresAuthenticationBeforeProvider(t *testing.T) {
	authorizer := &chatModerationAuthorizerStub{}
	provider := &chatModerationProviderStub{decision: chat.ModerationAllowed}
	req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/chats/chat-1/moderation", strings.NewReader(`{"text":"do not forward"}`))
	res := httptest.NewRecorder()

	chatModeration(authorizer, provider, nil)(res, req)
	if res.Code != http.StatusUnauthorized || authorizer.calls != 0 || provider.calls != 0 {
		t.Fatalf("status=%d authorizer=%d provider=%d, want unauthenticated request not forwarded", res.Code, authorizer.calls, provider.calls)
	}
}

func TestChatModerationBlockedHidesProviderCategories(t *testing.T) {
	req, sessions := authenticatedChatModerationRequest(t, `{"text":"message to inspect"}`)
	authorizer := &chatModerationAuthorizerStub{}
	provider := &chatModerationProviderStub{decision: chat.ModerationBlocked}
	res := httptest.NewRecorder()

	chatModeration(authorizer, provider, sessions)(res, req)
	if res.Code != http.StatusOK || provider.calls != 1 || authorizer.calls != 1 {
		t.Fatalf("status=%d authorizer=%d provider=%d", res.Code, authorizer.calls, provider.calls)
	}
	body := res.Body.String()
	if !strings.Contains(body, `"decision":"blocked"`) || strings.Contains(body, "category") || strings.Contains(body, "message to inspect") {
		t.Fatalf("unsafe moderation response: %s", body)
	}
}

func TestChatModerationUnavailableDoesNotExposeProviderFailure(t *testing.T) {
	req, sessions := authenticatedChatModerationRequest(t, `{"text":"message"}`)
	provider := &chatModerationProviderStub{err: context.DeadlineExceeded}
	res := httptest.NewRecorder()

	chatModeration(&chatModerationAuthorizerStub{}, provider, sessions)(res, req)
	body := res.Body.String()
	if res.Code != http.StatusOK || !strings.Contains(body, `"decision":"unavailable"`) || !strings.Contains(body, "moderation_unavailable") || strings.Contains(body, "DeadlineExceeded") {
		t.Fatalf("unsafe unavailable response: status=%d body=%s", res.Code, body)
	}
}

func TestChatModerationRejectsUnauthorizedChatBeforePlaintextProviderCall(t *testing.T) {
	req, sessions := authenticatedChatModerationRequest(t, `{"text":"do not forward"}`)
	authorizer := &chatModerationAuthorizerStub{err: chat.ErrChatForbidden}
	provider := &chatModerationProviderStub{decision: chat.ModerationAllowed}
	res := httptest.NewRecorder()

	chatModeration(authorizer, provider, sessions)(res, req)
	if res.Code != http.StatusForbidden || provider.calls != 0 {
		t.Fatalf("status=%d provider=%d, want forbidden chat masked before provider", res.Code, provider.calls)
	}
}

func TestChatModerationRejectsOversizedInput(t *testing.T) {
	req, sessions := authenticatedChatModerationRequest(t, `{"text":"`+strings.Repeat("a", maxChatModerationRunes+1)+`"}`)
	provider := &chatModerationProviderStub{decision: chat.ModerationAllowed}
	res := httptest.NewRecorder()

	chatModeration(&chatModerationAuthorizerStub{}, provider, sessions)(res, req)
	if res.Code != http.StatusBadRequest || provider.calls != 0 {
		t.Fatalf("status=%d provider=%d, want oversized plaintext rejected", res.Code, provider.calls)
	}
}

func authenticatedChatModerationRequest(t *testing.T, body string) (*http.Request, *auth.SessionService) {
	t.Helper()
	seed, sessions := newAuthenticatedClassificationRequest(t)
	req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/chats/chat-1/moderation", strings.NewReader(body))
	req.Header.Set("Authorization", seed.Header.Get("Authorization"))
	req.Header.Set("Content-Type", "application/json")
	return req, sessions
}

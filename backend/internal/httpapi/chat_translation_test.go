package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/translation"
)

type chatTranslationAuthorizerStub struct {
	calls int
	err   error
}

func (s *chatTranslationAuthorizerStub) AuthorizeMessageTranslation(context.Context, string, string) error {
	s.calls++
	return s.err
}

type chatTranslationProviderStub struct {
	available bool
	calls     int
	userID    string
	text      string
	target    string
	result    translation.Result
	err       error
}

type chatTranslationCacheStub struct {
	cached   chat.EncryptedMessageTranslation
	found    bool
	revision string
	lookups  int
	saves    int
	saved    chat.EncryptedMessageTranslation
}

func (s *chatTranslationCacheStub) LookupMessageTranslation(context.Context, string, string, string, string) (chat.EncryptedMessageTranslation, bool, string, error) {
	s.lookups++
	return s.cached, s.found, s.revision, nil
}

func (s *chatTranslationCacheStub) SaveMessageTranslation(_ context.Context, _, _, _ string, input chat.EncryptedMessageTranslation, _ time.Time) error {
	s.saves++
	s.saved = input
	return nil
}

func (s *chatTranslationProviderStub) Available() bool { return s.available }

func (s *chatTranslationProviderStub) Translate(_ context.Context, userID, text, target string) (translation.Result, error) {
	s.calls++
	s.userID, s.text, s.target = userID, text, target
	return s.result, s.err
}

func TestChatTranslationRequiresAuthenticationBeforeProvider(t *testing.T) {
	authorizer := &chatTranslationAuthorizerStub{}
	provider := &chatTranslationProviderStub{available: true}
	req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/chats/chat-1/translate", strings.NewReader(`{"message_id":"message-1","text":"do not forward","target_language":"ja"}`))
	res := httptest.NewRecorder()

	chatTranslation(authorizer, provider, nil, nil)(res, req)
	if res.Code != http.StatusUnauthorized || authorizer.calls != 0 || provider.calls != 0 {
		t.Fatalf("status=%d authorizer=%d provider=%d, want unauthenticated request not forwarded", res.Code, authorizer.calls, provider.calls)
	}
}

func TestChatTranslationAuthorizesBeforeForwardingPlaintext(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"do not forward","target_language":"ja"}`)
	authorizer := &chatTranslationAuthorizerStub{err: chat.ErrChatForbidden}
	provider := &chatTranslationProviderStub{available: true}
	res := httptest.NewRecorder()

	chatTranslation(authorizer, provider, nil, sessions)(res, req)
	if res.Code != http.StatusForbidden || authorizer.calls != 1 || provider.calls != 0 {
		t.Fatalf("status=%d authorizer=%d provider=%d, want forbidden before provider", res.Code, authorizer.calls, provider.calls)
	}
}

func TestChatTranslationReturnsOnlyTranslatedContract(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"Hello from Kyoto","target_language":"ja"}`)
	authorizer := &chatTranslationAuthorizerStub{}
	provider := &chatTranslationProviderStub{
		available: true,
		result:    translation.Result{SourceLanguage: "en", Translation: "京都からこんにちは"},
	}
	res := httptest.NewRecorder()

	chatTranslation(authorizer, provider, nil, sessions)(res, req)
	if res.Code != http.StatusOK || authorizer.calls != 1 || provider.calls != 1 {
		t.Fatalf("status=%d authorizer=%d provider=%d", res.Code, authorizer.calls, provider.calls)
	}
	if provider.userID != "user-1" || provider.text != "Hello from Kyoto" || provider.target != "ja" {
		t.Fatalf("provider input = user=%q text=%q target=%q", provider.userID, provider.text, provider.target)
	}
	body := res.Body.String()
	if !strings.Contains(body, `"source_language":"en"`) || !strings.Contains(body, `"translated_text":"京都からこんにちは"`) || strings.Contains(body, "Hello from Kyoto") {
		t.Fatalf("translation response leaked or omitted data: %s", body)
	}
}

func TestChatTranslationUsesEncryptedCacheBeforeProvider(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"Hello from Kyoto","target_language":"ja"}`)
	cache := &chatTranslationCacheStub{
		found:    true,
		revision: "2026-08-30T00:00:00Z",
		cached: chat.EncryptedMessageTranslation{
			TargetLanguage:  "ja",
			Ciphertext:      "opaque-ciphertext",
			Nonce:           "opaque-nonce",
			Algorithm:       "AES-256-GCM",
			KeyVersion:      "chat-translation-keyb-v1",
			MessageRevision: "2026-08-30T00:00:00Z",
		},
	}
	provider := &chatTranslationProviderStub{available: true}
	res := httptest.NewRecorder()

	chatTranslation(&chatTranslationAuthorizerStub{}, provider, cache, sessions)(res, req)
	if res.Code != http.StatusOK || cache.lookups != 1 || provider.calls != 0 {
		t.Fatalf("status=%d cache lookups=%d provider=%d, want encrypted cache hit without provider", res.Code, cache.lookups, provider.calls)
	}
	body := res.Body.String()
	if !strings.Contains(body, `"cached":true`) || !strings.Contains(body, `"ciphertext":"opaque-ciphertext"`) || strings.Contains(body, "translated_text") || strings.Contains(body, "Hello from Kyoto") {
		t.Fatalf("cache response leaked or omitted data: %s", body)
	}
}

func TestChatMessageTranslationStoresOnlyEncryptedEnvelope(t *testing.T) {
	seed, sessions := newAuthenticatedClassificationRequest(t)
	request := httptest.NewRequest(http.MethodPut, APIV1Prefix+"/chats/chat-1/messages/message-1/translations/ja", strings.NewReader(`{"target_language":"ja","ciphertext":"opaque-ciphertext","nonce":"opaque-nonce","algorithm":"AES-256-GCM","key_version":"chat-translation-keyb-v1","message_revision":"2026-08-30T00:00:00Z"}`))
	request.Header.Set("Authorization", seed.Header.Get("Authorization"))
	request.Header.Set("Content-Type", "application/json")
	cache := &chatTranslationCacheStub{}
	res := httptest.NewRecorder()

	chatMessageTranslation(cache, sessions, "user-1", "chat-1", "message-1", "ja")(res, request)
	if res.Code != http.StatusNoContent || cache.saves != 1 {
		t.Fatalf("status=%d cache saves=%d, want encrypted envelope saved", res.Code, cache.saves)
	}
	if cache.saved.Ciphertext != "opaque-ciphertext" || cache.saved.Nonce != "opaque-nonce" || cache.saved.TargetLanguage != "ja" {
		t.Fatalf("saved envelope = %+v", cache.saved)
	}
}

func TestChatPathPartsAllowsMessageTranslationEndpoint(t *testing.T) {
	chatID, rest, ok := chatPathParts(APIV1Prefix + "/chats/chat-1/messages/message-1/translations/ja")
	if !ok || chatID != "chat-1" || strings.Join(rest, "/") != "messages/message-1/translations/ja" {
		t.Fatalf("chat path = chatID=%q rest=%v ok=%v", chatID, rest, ok)
	}
}

func TestChatTranslationRejectsInvalidInputBeforeProvider(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"hello","target_language":"fr"}`)
	provider := &chatTranslationProviderStub{available: true}
	res := httptest.NewRecorder()

	chatTranslation(&chatTranslationAuthorizerStub{}, provider, nil, sessions)(res, req)
	if res.Code != http.StatusBadRequest || provider.calls != 0 {
		t.Fatalf("status=%d provider=%d, want invalid request rejected", res.Code, provider.calls)
	}
}

func TestChatTranslationUnavailableDoesNotExposeProviderDetails(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"hello","target_language":"ja"}`)
	provider := &chatTranslationProviderStub{available: false}
	res := httptest.NewRecorder()

	chatTranslation(&chatTranslationAuthorizerStub{}, provider, nil, sessions)(res, req)
	if res.Code != http.StatusServiceUnavailable || provider.calls != 0 || strings.Contains(res.Body.String(), "provider") {
		t.Fatalf("status=%d provider=%d body=%s", res.Code, provider.calls, res.Body.String())
	}
}

func authenticatedChatTranslationRequest(t *testing.T, body string) (*http.Request, *auth.SessionService) {
	t.Helper()
	seed, sessions := newAuthenticatedClassificationRequest(t)
	req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/chats/chat-1/translate", strings.NewReader(body))
	req.Header.Set("Authorization", seed.Header.Get("Authorization"))
	req.Header.Set("Content-Type", "application/json")
	return req, sessions
}

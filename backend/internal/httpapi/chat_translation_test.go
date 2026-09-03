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
	calls          int
	err            error
	revision       string
	limiterCalls   int
	limiterErr     error
	releaseCalls   int
	limiterUserID  string
	authorizedText string
	authorizedKey  string
}

func (s *chatTranslationAuthorizerStub) AuthorizeMessageTranslation(_ context.Context, _, _, _, text, commitmentKey string) (string, error) {
	s.calls++
	s.authorizedText = text
	s.authorizedKey = commitmentKey
	if s.revision == "" {
		s.revision = "2026-08-30T00:00:00Z"
	}
	return s.revision, s.err
}

func (s *chatTranslationAuthorizerStub) BeginMessageTranslation(_ context.Context, userID, _ string, _ string, _ string, _ string, _ string, _ string, _ time.Time) (func(), error) {
	s.limiterCalls++
	s.limiterUserID = userID
	if s.limiterErr != nil {
		return nil, s.limiterErr
	}
	return func() { s.releaseCalls++ }, nil
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
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"Hello from Kyoto","plaintext_commitment_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","target_language":"ja"}`)
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
	if authorizer.authorizedText != "Hello from Kyoto" || authorizer.authorizedKey != "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" {
		t.Fatalf("authorization binding = text=%q key=%q", authorizer.authorizedText, authorizer.authorizedKey)
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
			KeyVersion:      "chat-translation-dek-v1",
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

func TestChatTranslationUsesLegacyEncryptedCacheWithoutBinding(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"legacy plaintext","target_language":"ja"}`)
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
	authorizer := &chatTranslationAuthorizerStub{err: chat.ErrTranslationBindingMissing}
	provider := &chatTranslationProviderStub{available: true}
	res := httptest.NewRecorder()

	chatTranslation(authorizer, provider, cache, sessions)(res, req)
	if res.Code != http.StatusOK || cache.lookups != 1 || provider.calls != 0 || authorizer.limiterCalls != 0 {
		t.Fatalf("status=%d cache lookups=%d provider=%d limiter=%d, want legacy cache hit without provider", res.Code, cache.lookups, provider.calls, authorizer.limiterCalls)
	}
}

func TestChatTranslationRejectsRevisionChangedBeforeProvider(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"Hello from Kyoto","target_language":"ja"}`)
	cache := &chatTranslationCacheStub{revision: "2026-08-31T00:00:00Z"}
	provider := &chatTranslationProviderStub{available: true}
	authorizer := &chatTranslationAuthorizerStub{revision: "2026-08-30T00:00:00Z"}
	res := httptest.NewRecorder()

	chatTranslation(authorizer, provider, cache, sessions)(res, req)
	if res.Code != http.StatusConflict || provider.calls != 0 || authorizer.limiterCalls != 0 {
		t.Fatalf("status=%d provider=%d limiter=%d, want stale revision rejected before provider", res.Code, provider.calls, authorizer.limiterCalls)
	}
	if !strings.Contains(res.Body.String(), `"chat_translation_stale"`) {
		t.Fatalf("stale revision response = %s", res.Body.String())
	}
}

func TestChatTranslationAppliesAccountRateLimitBeforeProvider(t *testing.T) {
	req, sessions := authenticatedChatTranslationRequest(t, `{"message_id":"message-1","text":"Hello from Kyoto","target_language":"ja"}`)
	authorizer := &chatTranslationAuthorizerStub{
		limiterErr: &chat.TranslationRateLimitError{RetryAfter: 7 * time.Second},
	}
	provider := &chatTranslationProviderStub{available: true}
	res := httptest.NewRecorder()

	chatTranslation(authorizer, provider, nil, sessions)(res, req)
	if res.Code != http.StatusTooManyRequests || provider.calls != 0 || authorizer.limiterCalls != 1 || authorizer.limiterUserID != "user-1" {
		t.Fatalf("status=%d provider=%d limiter=%d user=%q, want provider blocked by account limiter", res.Code, provider.calls, authorizer.limiterCalls, authorizer.limiterUserID)
	}
	if res.Header().Get("Retry-After") != "7" || !strings.Contains(res.Body.String(), `"chat_translation_rate_limited"`) {
		t.Fatalf("rate-limit response = headers=%v body=%s", res.Header(), res.Body.String())
	}
}

func TestChatMessageTranslationStoresOnlyEncryptedEnvelope(t *testing.T) {
	seed, sessions := newAuthenticatedClassificationRequest(t)
	request := httptest.NewRequest(http.MethodPut, APIV1Prefix+"/chats/chat-1/messages/message-1/translations/ja", strings.NewReader(`{"target_language":"ja","ciphertext":"opaque-ciphertext","nonce":"opaque-nonce","algorithm":"AES-256-GCM","key_version":"chat-translation-dek-v1","message_revision":"2026-08-30T00:00:00Z"}`))
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

func TestChatPathPartsAllowsChatSummaryEndpoint(t *testing.T) {
	chatID, rest, ok := chatPathParts(APIV1Prefix + "/chats/chat-1")
	if !ok || chatID != "chat-1" || len(rest) != 0 {
		t.Fatalf("chat summary path = chatID=%q rest=%v ok=%v", chatID, rest, ok)
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

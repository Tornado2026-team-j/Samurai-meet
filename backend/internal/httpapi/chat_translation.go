package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/translation"
)

const maxChatTranslationRequestBytes = 16 * 1024

type chatTranslationAuthorizer interface {
	AuthorizeMessageTranslation(context.Context, string, string, string, string) (string, error)
}

type chatTranslationLimiter interface {
	BeginMessageTranslation(context.Context, string, string, string, string, string, time.Time) (func(), error)
}

type chatTranslationService interface {
	chatTranslationAuthorizer
	chatTranslationLimiter
}

type chatTranslator interface {
	Available() bool
	Translate(context.Context, string, string, string) (translation.Result, error)
}

type chatTranslationCache interface {
	LookupMessageTranslation(context.Context, string, string, string, string) (chat.EncryptedMessageTranslation, bool, string, error)
	SaveMessageTranslation(context.Context, string, string, string, chat.EncryptedMessageTranslation, time.Time) error
}

// chatTranslation accepts plaintext only for the request-scoped provider call.
// The resulting plaintext is returned to the client, which encrypts it with
// the per-chat DEK before saving the cache through chatMessageTranslation.
func chatTranslation(service chatTranslationService, provider chatTranslator, cache chatTranslationCache, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		chatID, rest, ok := chatPathParts(r.URL.Path)
		if !ok || len(rest) != 1 || rest[0] != "translate" || service == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat_not_found"})
			return
		}
		// Parse the request before authorization, then bind the supplied text to
		// the stored message commitment before any provider call is possible.
		var input struct {
			MessageID      string `json:"message_id"`
			Text           string `json:"text"`
			TargetLanguage string `json:"target_language"`
		}
		if err := decodeJSONRequest(w, r, &input, maxChatTranslationRequestBytes); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_translation_request"})
			return
		}
		messageID := strings.TrimSpace(input.MessageID)
		text := strings.TrimSpace(input.Text)
		targetLanguage := strings.ToLower(strings.TrimSpace(input.TargetLanguage))
		defer func() {
			input.MessageID = ""
			input.Text = ""
			text = ""
		}()
		if messageID == "" || !utf8.ValidString(messageID) || utf8.RuneCountInString(messageID) > 128 ||
			text == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > 2_000 ||
			(targetLanguage != "ja" && targetLanguage != "en") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_translation_request"})
			return
		}
		revision, err := service.AuthorizeMessageTranslation(r.Context(), claims.Subject, chatID, messageID, text)
		if err != nil {
			if errors.Is(err, chat.ErrTranslationBindingMissing) && cache != nil {
				cached, found, _, cacheErr := cache.LookupMessageTranslation(r.Context(), claims.Subject, chatID, messageID, targetLanguage)
				if cacheErr != nil {
					writeChatError(w, cacheErr)
					return
				}
				if found {
					writeCachedChatTranslation(w, targetLanguage, cached)
					return
				}
			}
			writeChatError(w, err)
			return
		}

		if cache != nil {
			cached, found, currentRevision, cacheErr := cache.LookupMessageTranslation(r.Context(), claims.Subject, chatID, messageID, targetLanguage)
			if cacheErr != nil {
				writeChatError(w, cacheErr)
				return
			}
			if currentRevision != "" && currentRevision != revision {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "chat_translation_stale"})
				return
			}
			revision = currentRevision
			if found {
				writeCachedChatTranslation(w, targetLanguage, cached)
				return
			}
		}
		if provider == nil || !provider.Available() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_translation_unavailable"})
			return
		}
		release, err := service.BeginMessageTranslation(r.Context(), claims.Subject, chatID, messageID, revision, targetLanguage, time.Now())
		if err != nil {
			writeChatError(w, err)
			return
		}
		defer release()

		result, err := provider.Translate(r.Context(), claims.Subject, text, targetLanguage)
		switch {
		case err == nil:
			data := map[string]any{
				"cached":          false,
				"source_language": result.SourceLanguage,
				"translated_text": result.Translation,
				"target_language": targetLanguage,
			}
			if revision != "" {
				data["message_revision"] = revision
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": data})
		case errors.Is(err, translation.ErrInvalidInput):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_translation_request"})
		case errors.Is(err, translation.ErrUnavailable), errors.Is(err, translation.ErrProviderUnavailable):
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_translation_unavailable"})
		case errors.Is(err, translation.ErrProviderRateLimited):
			w.Header().Set("Retry-After", "5")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "chat_translation_rate_limited"})
		default:
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "chat_translation_failed"})
		}
	}
}

func writeCachedChatTranslation(w http.ResponseWriter, targetLanguage string, cached chat.EncryptedMessageTranslation) {
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"cached":           true,
		"target_language":  targetLanguage,
		"message_revision": cached.MessageRevision,
		"ciphertext":       cached.Ciphertext,
		"nonce":            cached.Nonce,
		"algorithm":        cached.Algorithm,
		"key_version":      cached.KeyVersion,
	}})
}

func chatMessageTranslation(
	service chatTranslationCache,
	sessions *auth.SessionService,
	userID string,
	chatID string,
	messageID string,
	targetLanguage string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok || claims.Subject != userID {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_translation_unavailable"})
			return
		}
		var input chat.EncryptedMessageTranslation
		if err := decodeJSONRequest(w, r, &input, 192*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_translation_request"})
			return
		}
		pathTarget := strings.ToLower(strings.TrimSpace(targetLanguage))
		bodyTarget := strings.ToLower(strings.TrimSpace(input.TargetLanguage))
		if bodyTarget != "" && bodyTarget != pathTarget {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_translation_request"})
			return
		}
		input.TargetLanguage = pathTarget
		if err := service.SaveMessageTranslation(r.Context(), claims.Subject, chatID, messageID, input, time.Now()); err != nil {
			switch {
			case errors.Is(err, chat.ErrMessageTranslationStale):
				writeJSON(w, http.StatusConflict, map[string]string{"error": "chat_translation_stale"})
			default:
				writeChatError(w, err)
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

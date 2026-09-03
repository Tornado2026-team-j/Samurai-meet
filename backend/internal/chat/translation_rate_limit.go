package chat

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"
)

const (
	defaultTranslationAccountBurst      = 30
	defaultTranslationAccountRefillRate = 0.5 // 30 provider attempts per minute
	defaultTranslationMaxInFlight       = 2
	translationInflightTTL              = 30 * time.Second
	translationInflightRenewInterval    = translationInflightTTL / 3
)

var (
	ErrTranslationRateLimited        = errors.New("chat translation account rate limit exceeded")
	ErrTranslationLimiterUnavailable = errors.New("chat translation rate limiter is unavailable")
)

// TranslationRateLimitError carries a bounded retry hint for the account
// bucket or account-wide in-flight concurrency gate.
type TranslationRateLimitError struct {
	RetryAfter time.Duration
}

func (e *TranslationRateLimitError) Error() string { return ErrTranslationRateLimited.Error() }

func (e *TranslationRateLimitError) Is(target error) bool { return target == ErrTranslationRateLimited }

type translationRateLimiter struct {
	mu              sync.RWMutex
	accountBurst    float64
	refillPerSecond float64
	maxInFlight     int
}

func newTranslationRateLimiter() *translationRateLimiter {
	return &translationRateLimiter{
		accountBurst:    defaultTranslationAccountBurst,
		refillPerSecond: defaultTranslationAccountRefillRate,
		maxInFlight:     defaultTranslationMaxInFlight,
	}
}

func (l *translationRateLimiter) configure(accountBurst int, refillPerSecond float64, maxInFlight int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if accountBurst > 0 {
		l.accountBurst = float64(accountBurst)
	}
	if refillPerSecond > 0 {
		l.refillPerSecond = refillPerSecond
	}
	if maxInFlight > 0 {
		l.maxInFlight = maxInFlight
	}
}

func (l *translationRateLimiter) snapshot() (float64, float64, int) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.accountBurst, l.refillPerSecond, l.maxInFlight
}

// BeginMessageTranslation rechecks the message binding and revision, reserves
// one provider attempt for an authenticated account, and holds the message row
// lock until the provider call finishes. The state is PostgreSQL-backed so all
// API instances share one quota. The returned release function removes only
// this request's short-lived in-flight marker and releases the message lock;
// the token is intentionally not refunded after a provider call, including an
// upstream failure or 429.
func (s *Service) BeginMessageTranslation(
	ctx context.Context,
	userID string,
	chatID string,
	messageID string,
	revision string,
	text string,
	commitmentKey string,
	targetLanguage string,
	now time.Time,
) (func(), error) {
	if s == nil || s.db == nil || s.translationLimiter == nil {
		return nil, ErrTranslationLimiterUnavailable
	}
	if !validIdentifier(userID, maxClientMessageID) || !validIdentifier(chatID, maxClientMessageID) ||
		!validIdentifier(messageID, maxClientMessageID) || !validIdentifier(revision, maxMessageRevision) {
		return nil, ErrChatInvalidInput
	}
	targetLanguage, err := normalizeTranslationTarget(targetLanguage)
	if err != nil {
		return nil, err
	}
	accountBurst, refillPerSecond, maxInFlight := s.translationLimiter.snapshot()
	if accountBurst <= 0 || refillPerSecond <= 0 || maxInFlight <= 0 {
		return nil, ErrTranslationLimiterUnavailable
	}
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}
	stamp := now.Format(time.RFC3339Nano)
	nowUnix := float64(now.UnixNano()) / float64(time.Second)
	scopeKey := "account:" + userID
	requestKey := translationInflightKey(userID, chatID, messageID, revision, targetLanguage)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, wrapTranslationLimiterError(err)
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO chat_translation_rate_limits (scope_key,tokens,last_refill_unix,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$4)
		ON CONFLICT (scope_key) DO NOTHING`, scopeKey, accountBurst, nowUnix, stamp); err != nil {
		return nil, wrapTranslationLimiterError(err)
	}

	var tokens, lastRefillUnix float64
	if err = tx.QueryRowContext(ctx, `
		SELECT tokens,last_refill_unix
		FROM chat_translation_rate_limits
		WHERE scope_key=$1
		FOR UPDATE`, scopeKey).Scan(&tokens, &lastRefillUnix); err != nil {
		return nil, wrapTranslationLimiterError(err)
	}
	if tokens < 0 || math.IsNaN(tokens) || math.IsInf(tokens, 0) || math.IsNaN(lastRefillUnix) || math.IsInf(lastRefillUnix, 0) {
		return nil, wrapTranslationLimiterError(errors.New("invalid translation limiter state"))
	}
	if tokens > accountBurst {
		tokens = accountBurst
	}
	if nowUnix > lastRefillUnix {
		tokens = math.Min(accountBurst, tokens+(nowUnix-lastRefillUnix)*refillPerSecond)
		lastRefillUnix = nowUnix
	} else if lastRefillUnix > nowUnix {
		// A backwards wall-clock adjustment must not create free tokens.
		// Keep the previous timestamp so the same interval cannot be refilled again.
		// lastRefillUnix intentionally remains unchanged.
	}

	if _, err = tx.ExecContext(ctx, `
		DELETE FROM chat_translation_inflight
		WHERE user_id=$1 AND expires_at <= $2`, userID, now); err != nil {
		return nil, wrapTranslationLimiterError(err)
	}
	var inFlight int
	if err = tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM chat_translation_inflight WHERE user_id=$1`, userID).Scan(&inFlight); err != nil {
		return nil, wrapTranslationLimiterError(err)
	}
	if inFlight >= maxInFlight {
		if err = updateTranslationBucket(ctx, tx, scopeKey, tokens, lastRefillUnix, stamp); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		if err = tx.Commit(); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		return nil, newTranslationRateLimitError(time.Second)
	}
	var duplicate bool
	if err = tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM chat_translation_inflight
			WHERE request_key=$1 AND user_id=$2
		)`, requestKey, userID).Scan(&duplicate); err != nil {
		return nil, wrapTranslationLimiterError(err)
	}
	if duplicate {
		if err = updateTranslationBucket(ctx, tx, scopeKey, tokens, lastRefillUnix, stamp); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		if err = tx.Commit(); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		return nil, newTranslationRateLimitError(time.Second)
	}
	if tokens < 1 {
		if err = updateTranslationBucket(ctx, tx, scopeKey, tokens, lastRefillUnix, stamp); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		if err = tx.Commit(); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		return nil, newTranslationRateLimitError(translationTokenRetryAfter(tokens, refillPerSecond))
	}
	currentRevision, err := s.messageTranslationRevision(ctx, tx, chatID, messageID, true)
	if err != nil {
		return nil, err
	}
	if currentRevision != revision {
		return nil, ErrMessageTranslationStale
	}

	expiresAt := now.Add(translationInflightTTL)
	var inserted int64
	if err = tx.QueryRowContext(ctx, `
		INSERT INTO chat_translation_inflight (request_key,user_id,chat_id,expires_at,created_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (request_key) DO NOTHING
		RETURNING 1`, requestKey, userID, chatID, expiresAt, stamp).Scan(&inserted); errors.Is(err, sql.ErrNoRows) {
		if err = updateTranslationBucket(ctx, tx, scopeKey, tokens, lastRefillUnix, stamp); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		if err = tx.Commit(); err != nil {
			return nil, wrapTranslationLimiterError(err)
		}
		return nil, newTranslationRateLimitError(time.Second)
	} else if err != nil {
		return nil, wrapTranslationLimiterError(err)
	}
	if inserted != 1 {
		return nil, wrapTranslationLimiterError(errors.New("translation limiter insert returned an invalid result"))
	}
	if err = updateTranslationBucket(ctx, tx, scopeKey, tokens-1, lastRefillUnix, stamp); err != nil {
		return nil, wrapTranslationLimiterError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, wrapTranslationLimiterError(err)
	}

	leaseCtx, leaseCancel := context.WithCancel(context.Background())
	var leaseWait sync.WaitGroup
	leaseWait.Add(1)
	go func() {
		defer leaseWait.Done()
		renewTranslationInflight(leaseCtx, s.db, requestKey, userID)
	}()
	var releaseLeaseOnce sync.Once
	releaseLease := func() {
		releaseLeaseOnce.Do(func() {
			leaseCancel()
			leaseWait.Wait()
			releaseCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_, _ = s.db.ExecContext(releaseCtx, `
				DELETE FROM chat_translation_inflight WHERE request_key=$1 AND user_id=$2`, requestKey, userID)
		})
	}

	// The reservation and the row lock use separate transactions. This keeps
	// the account bucket lock short while ensuring an edit that starts after
	// this point waits until the external provider call has completed. The
	// second binding check closes the small gap between those transactions.
	messageTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		releaseLease()
		return nil, wrapTranslationLimiterError(err)
	}
	lockedRevision, err := s.messageTranslationRevision(ctx, messageTx, chatID, messageID, true)
	if err != nil {
		_ = messageTx.Rollback()
		releaseLease()
		return nil, err
	}
	if lockedRevision != revision {
		_ = messageTx.Rollback()
		releaseLease()
		return nil, ErrMessageTranslationStale
	}
	if _, err = s.messageTranslationRevisionForText(ctx, messageTx, chatID, messageID, text, commitmentKey, true, false); err != nil {
		_ = messageTx.Rollback()
		releaseLease()
		return nil, err
	}

	var releaseOnce sync.Once
	release := func() {
		releaseOnce.Do(func() {
			releaseLease()
			_ = messageTx.Rollback()
		})
	}
	return release, nil
}

func renewTranslationInflight(ctx context.Context, db *sql.DB, requestKey, userID string) {
	ticker := time.NewTicker(translationInflightRenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			renewCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			_, _ = db.ExecContext(renewCtx, `
				UPDATE chat_translation_inflight SET expires_at=$3
				WHERE request_key=$1 AND user_id=$2`, requestKey, userID, time.Now().UTC().Add(translationInflightTTL))
			cancel()
		}
	}
}

func updateTranslationBucket(ctx context.Context, tx *sql.Tx, scopeKey string, tokens, lastRefillUnix float64, stamp string) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE chat_translation_rate_limits
		SET tokens=$2,last_refill_unix=$3,updated_at=$4
		WHERE scope_key=$1`, scopeKey, tokens, lastRefillUnix, stamp)
	return err
}

func translationInflightKey(userID, chatID, messageID, revision, targetLanguage string) string {
	digest := sha256.Sum256([]byte(strings.Join([]string{
		"samurai-meet:chat-translation-inflight/v1",
		userID,
		chatID,
		messageID,
		revision,
		targetLanguage,
	}, "\n")))
	return hex.EncodeToString(digest[:])
}

func newTranslationRateLimitError(retryAfter time.Duration) error {
	if retryAfter < time.Second {
		retryAfter = time.Second
	}
	return &TranslationRateLimitError{RetryAfter: retryAfter}
}

func translationTokenRetryAfter(tokens, refillPerSecond float64) time.Duration {
	if refillPerSecond <= 0 {
		return time.Minute
	}
	seconds := math.Ceil((1 - tokens) / refillPerSecond * float64(time.Second))
	if seconds < float64(time.Second) {
		seconds = float64(time.Second)
	}
	if seconds > float64(24*time.Hour) {
		seconds = float64(24 * time.Hour)
	}
	return time.Duration(seconds)
}

func wrapTranslationLimiterError(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %v", ErrTranslationLimiterUnavailable, err)
}

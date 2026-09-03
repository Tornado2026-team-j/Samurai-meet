package chat

import (
	"errors"
	"math"
	"sync"
	"time"
)

// ErrChatRateLimited is returned when a sender exceeds the per-user message
// send budget. Callers can pull the retry hint with errors.As and a
// *RateLimitError.
var ErrChatRateLimited = errors.New("chat send rate limit exceeded")

// RateLimitError carries how long the caller should wait before retrying.
type RateLimitError struct{ RetryAfter time.Duration }

func (e *RateLimitError) Error() string { return ErrChatRateLimited.Error() }

// Is lets errors.Is(err, ErrChatRateLimited) match a *RateLimitError so HTTP
// and HTTP/WebTransport callers share one classification path.
func (e *RateLimitError) Is(target error) bool { return target == ErrChatRateLimited }

const (
	defaultSendBurst          = 15
	defaultSendRefillPerSec   = 1.0
	maxSendRateLimiterEntries = 8192
)

// sendRateLimiter is a per-user token bucket. Capacity absorbs a legitimate
// burst (pasting a few messages, rapid short replies); the refill rate caps the
// sustained send rate and is what actually blocks a flood. It is a spam and
// harassment control: the 4-connection cap alone does not stop one socket from
// posting hundreds of messages.
type sendRateLimiter struct {
	mu         sync.Mutex
	buckets    map[string]sendBucket
	capacity   float64
	refillRate float64 // tokens per second
}

type sendBucket struct {
	tokens float64
	last   time.Time
}

func newSendRateLimiter() *sendRateLimiter {
	return &sendRateLimiter{
		buckets:    make(map[string]sendBucket),
		capacity:   defaultSendBurst,
		refillRate: defaultSendRefillPerSec,
	}
}

// configure overrides the bucket parameters. Non-positive values keep the
// current setting so a partial configuration cannot disable the limiter.
func (l *sendRateLimiter) configure(capacity int, refillPerSecond float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if capacity > 0 {
		l.capacity = float64(capacity)
	}
	if refillPerSecond > 0 {
		l.refillRate = refillPerSecond
	}
	l.buckets = make(map[string]sendBucket)
}

// allow consumes one token for userID. It reports whether the send is allowed
// and, when it is not, how long until the next token is available.
func (l *sendRateLimiter) allow(userID string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.buckets) >= maxSendRateLimiterEntries {
		for key, bucket := range l.buckets {
			if now.Sub(bucket.last) >= 10*time.Minute {
				delete(l.buckets, key)
			}
		}
		if len(l.buckets) >= maxSendRateLimiterEntries {
			for key := range l.buckets {
				delete(l.buckets, key)
				break
			}
		}
	}

	bucket, ok := l.buckets[userID]
	if !ok {
		bucket = sendBucket{tokens: l.capacity, last: now}
	} else {
		elapsed := now.Sub(bucket.last).Seconds()
		if elapsed > 0 {
			bucket.tokens = math.Min(l.capacity, bucket.tokens+elapsed*l.refillRate)
			bucket.last = now
		}
	}

	if bucket.tokens < 1 {
		missing := 1 - bucket.tokens
		retryAfter := time.Duration(missing / l.refillRate * float64(time.Second))
		if retryAfter < time.Second {
			retryAfter = time.Second
		}
		l.buckets[userID] = bucket
		return false, retryAfter
	}

	bucket.tokens--
	l.buckets[userID] = bucket
	return true, 0
}

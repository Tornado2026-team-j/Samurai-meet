package chat

import (
	"errors"
	"testing"
	"time"
)

func TestSendRateLimiterBurstThenRefill(t *testing.T) {
	l := newSendRateLimiter()
	l.configure(3, 1) // capacity 3, 1 token/sec
	now := time.Unix(1_700_000_000, 0)

	for i := 0; i < 3; i++ {
		if ok, _ := l.allow("alice", now); !ok {
			t.Fatalf("burst send %d was rejected", i)
		}
	}
	ok, retryAfter := l.allow("alice", now)
	if ok {
		t.Fatal("4th send in the burst should have been rejected")
	}
	if retryAfter <= 0 || retryAfter > time.Second {
		t.Fatalf("retryAfter = %v, want (0s, 1s]", retryAfter)
	}

	// A different user has an independent bucket.
	if ok, _ := l.allow("bob", now); !ok {
		t.Fatal("bob's first send was rejected by alice's usage")
	}

	// After 2 seconds alice has refilled 2 tokens.
	later := now.Add(2 * time.Second)
	for i := 0; i < 2; i++ {
		if ok, _ := l.allow("alice", later); !ok {
			t.Fatalf("refilled send %d was rejected", i)
		}
	}
	if ok, _ := l.allow("alice", later); ok {
		t.Fatal("alice exceeded the refilled budget")
	}
}

func TestSendRateLimiterConfigureIgnoresNonPositive(t *testing.T) {
	l := newSendRateLimiter()
	l.configure(0, 0)
	if l.capacity != defaultSendBurst || l.refillRate != defaultSendRefillPerSec {
		t.Fatalf("defaults were overwritten: capacity=%v refill=%v", l.capacity, l.refillRate)
	}
}

func TestRateLimitErrorClassification(t *testing.T) {
	err := error(&RateLimitError{RetryAfter: 3 * time.Second})
	if !errors.Is(err, ErrChatRateLimited) {
		t.Fatal("errors.Is(err, ErrChatRateLimited) = false")
	}
	var rl *RateLimitError
	if !errors.As(err, &rl) || rl.RetryAfter != 3*time.Second {
		t.Fatalf("errors.As lost the retry hint: %+v", rl)
	}
}

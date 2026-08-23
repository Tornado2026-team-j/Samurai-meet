package image

import (
	"testing"
	"time"
)

func TestCiphertextCacheExpiresEvictsAndInvalidates(t *testing.T) {
	now := time.Now()
	c := NewCiphertextCache(4, time.Second)
	c.Put("user/photo", []byte("abcd"), now)
	if _, ok := c.Get("user/photo", now); !ok {
		t.Fatal("missing cache")
	}
	c.InvalidatePrefix("user/")
	if _, ok := c.Get("user/photo", now); ok {
		t.Fatal("cache was not invalidated")
	}
	c.Put("one", []byte("abcd"), now)
	c.Put("two", []byte("z"), now)
	if _, ok := c.Get("one", now); ok {
		t.Fatal("old entry was not evicted")
	}
	if _, ok := c.Get("two", now.Add(2*time.Second)); ok {
		t.Fatal("expired entry accepted")
	}
}

package image

import (
	"sync"
	"time"
)

// CiphertextCache holds encrypted bytes only. It has a hard byte limit and is
// deliberately invalidated on deletion; plaintext and keys are never cached.
type CiphertextCache struct {
	mu             sync.Mutex
	maxBytes, size int
	ttl            time.Duration
	entries        map[string]cacheEntry
	order          []string
}
type cacheEntry struct {
	data      []byte
	expiresAt time.Time
}

func NewCiphertextCache(maxBytes int, ttl time.Duration) *CiphertextCache {
	return &CiphertextCache{maxBytes: maxBytes, ttl: ttl, entries: map[string]cacheEntry{}}
}
func (c *CiphertextCache) Get(key string, now time.Time) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || !now.Before(e.expiresAt) {
		if ok {
			c.remove(key)
		}
		return nil, false
	}
	return append([]byte(nil), e.data...), true
}
func (c *CiphertextCache) Put(key string, data []byte, now time.Time) {
	if len(data) > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; ok {
		c.remove(key)
	}
	for c.size+len(data) > c.maxBytes && len(c.order) > 0 {
		c.remove(c.order[0])
	}
	c.entries[key] = cacheEntry{append([]byte(nil), data...), now.Add(c.ttl)}
	c.order = append(c.order, key)
	c.size += len(data)
}
func (c *CiphertextCache) InvalidatePrefix(prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.entries {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			c.remove(key)
		}
	}
}
func (c *CiphertextCache) remove(key string) {
	e, ok := c.entries[key]
	if !ok {
		return
	}
	delete(c.entries, key)
	c.size -= len(e.data)
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			return
		}
	}
}

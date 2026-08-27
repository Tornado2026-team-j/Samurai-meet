package httpapi

import (
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	defaultRequestLimit  = 180
	defaultRequestWindow = time.Minute
	maxRateLimitEntries  = 4096
)

type rateLimitBucket struct {
	started time.Time
	count   int
}

type requestRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]rateLimitBucket
}

func newRequestRateLimiter() *requestRateLimiter {
	return &requestRateLimiter{buckets: make(map[string]rateLimitBucket)}
}

func (l *requestRateLimiter) allow(key string, limit int, window time.Duration, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.buckets) >= maxRateLimitEntries {
		for bucketKey, bucket := range l.buckets {
			if !now.Before(bucket.started.Add(window)) {
				delete(l.buckets, bucketKey)
			}
		}
		if len(l.buckets) >= maxRateLimitEntries {
			for bucketKey := range l.buckets {
				delete(l.buckets, bucketKey)
				break
			}
		}
	}
	bucket, ok := l.buckets[key]
	if !ok || !now.Before(bucket.started.Add(window)) {
		l.buckets[key] = rateLimitBucket{started: now, count: 1}
		return true, 0
	}
	if bucket.count >= limit {
		return false, bucket.started.Add(window).Sub(now)
	}
	bucket.count++
	l.buckets[key] = bucket
	return true, 0
}

func withSecurityHeadersAndRateLimit(next http.Handler) http.Handler {
	limiter := newRequestRateLimiter()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w, r)
		if r.Method != http.MethodOptions {
			if limit, window, class := requestRateProfile(r.URL.Path); limit > 0 {
				key := clientAddress(r) + "|" + class
				allowed, retryAfter := limiter.allow(key, limit, window, time.Now())
				if !allowed {
					seconds := int(math.Ceil(retryAfter.Seconds()))
					if seconds < 1 {
						seconds = 1
					}
					w.Header().Set("Retry-After", strconvItoa(seconds))
					writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func setSecurityHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=(), usb=()")
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
	if strings.HasPrefix(r.URL.Path, APIV1Prefix+"/") || r.URL.Path == "/auth/callback" {
		w.Header().Set("Cache-Control", "no-store")
	}
}

func requestRateProfile(path string) (int, time.Duration, string) {
	switch {
	case path == APIV1Prefix+"/auth/refresh":
		return 30, defaultRequestWindow, "refresh"
	case strings.HasPrefix(path, recoveryPath), strings.HasPrefix(path, APIV1Prefix+"/auth/passkey"), strings.HasPrefix(path, deviceTransferPath):
		return 15, defaultRequestWindow, "credential"
	case strings.HasPrefix(path, APIV1Prefix+"/auth/"):
		return 60, defaultRequestWindow, "auth"
	case strings.HasPrefix(path, APIV1Prefix+"/"):
		return defaultRequestLimit, defaultRequestWindow, "api"
	default:
		return 0, 0, ""
	}
}

func clientAddress(r *http.Request) string {
	if r == nil {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	if address := strings.TrimSpace(r.RemoteAddr); address != "" {
		return address
	}
	return "unknown"
}

func strconvItoa(value int) string {
	if value < 0 {
		return "0"
	}
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[index:])
}

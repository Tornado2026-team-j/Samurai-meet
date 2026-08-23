package auth

import (
	"testing"
	"time"
)

func TestSessionIsActiveAt(t *testing.T) {
	now := time.Date(2026, time.August, 23, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name    string
		session Session
		want    bool
	}{
		{
			name: "active session",
			session: Session{
				Status:    SessionActive,
				ExpiresAt: now.Add(time.Minute),
			},
			want: true,
		},
		{
			name: "expired session",
			session: Session{
				Status:    SessionActive,
				ExpiresAt: now,
			},
			want: false,
		},
		{
			name: "revoked session",
			session: Session{
				Status:    SessionRevoked,
				ExpiresAt: now.Add(time.Minute),
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.session.IsActiveAt(now); got != tt.want {
				t.Fatalf("IsActiveAt() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRefreshRequestIsRetryableAt(t *testing.T) {
	createdAt := time.Date(2026, time.August, 23, 0, 0, 0, 0, time.UTC)
	request := RefreshRequest{CreatedAt: createdAt}

	if !request.IsRetryableAt(createdAt.Add(RefreshRetryWindow)) {
		t.Fatal("refresh request should be retryable at the retry window boundary")
	}
	if request.IsRetryableAt(createdAt.Add(RefreshRetryWindow + time.Nanosecond)) {
		t.Fatal("refresh request should not be retryable after the retry window")
	}
}

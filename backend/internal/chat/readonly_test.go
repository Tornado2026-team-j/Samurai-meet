package chat

import (
	"testing"
	"time"
)

func TestChatWriteClosed(t *testing.T) {
	grace := 48 * time.Hour
	scheduledEnd := time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)
	expiresAt := scheduledEnd.Format(time.RFC3339Nano)

	for _, tc := range []struct {
		name    string
		expires string
		now     time.Time
		want    bool
	}{
		{"before scheduled end", expiresAt, scheduledEnd.Add(-time.Hour), false},
		{"within grace", expiresAt, scheduledEnd.Add(47 * time.Hour), false},
		{"exactly at grace boundary", expiresAt, scheduledEnd.Add(grace), false},
		{"just past grace", expiresAt, scheduledEnd.Add(grace + time.Minute), true},
		{"long past grace", expiresAt, scheduledEnd.Add(30 * 24 * time.Hour), true},
		{"blank expires_at fails open", "", scheduledEnd.Add(30 * 24 * time.Hour), false},
		{"corrupt expires_at fails open", "not-a-timestamp", scheduledEnd.Add(30 * 24 * time.Hour), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := chatWriteClosed(tc.expires, grace, tc.now); got != tc.want {
				t.Fatalf("chatWriteClosed(%q, %s, %s) = %v, want %v", tc.expires, grace, tc.now, got, tc.want)
			}
		})
	}
}

func TestConfigureReadOnlyGrace(t *testing.T) {
	s := NewService(nil, nil)
	if s.ReadOnlyGrace() != defaultReadOnlyGraceHours*time.Hour {
		t.Fatalf("default grace = %s, want %s", s.ReadOnlyGrace(), defaultReadOnlyGraceHours*time.Hour)
	}
	s.ConfigureReadOnlyGrace(72)
	if s.ReadOnlyGrace() != 72*time.Hour {
		t.Fatalf("grace after Configure(72) = %s, want 72h", s.ReadOnlyGrace())
	}
	s.ConfigureReadOnlyGrace(-1)
	if s.ReadOnlyGrace() != 72*time.Hour {
		t.Fatalf("negative Configure changed grace to %s, want unchanged 72h", s.ReadOnlyGrace())
	}
	s.ConfigureReadOnlyGrace(0)
	if s.ReadOnlyGrace() != 0 {
		t.Fatalf("Configure(0) grace = %s, want 0", s.ReadOnlyGrace())
	}
}

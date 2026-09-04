package memorymonster

import (
	"testing"
	"time"
)

func TestMemoryMonsterCreationWindow(t *testing.T) {
	endAt := time.Date(2026, time.September, 4, 14, 0, 0, 0, time.UTC)
	for name, test := range map[string]struct {
		now  time.Time
		want bool
	}{
		"before end": {now: endAt.Add(-time.Second), want: false},
		"at end":     {now: endAt, want: true},
		"inside":     {now: endAt.Add(12 * time.Hour), want: true},
		"at expiry":  {now: endAt.Add(MemoryMonsterCreationWindow), want: false},
	} {
		t.Run(name, func(t *testing.T) {
			if got := memoryMonsterCreationWindowOpen(endAt, test.now); got != test.want {
				t.Fatalf("memoryMonsterCreationWindowOpen() = %v, want %v", got, test.want)
			}
		})
	}
}

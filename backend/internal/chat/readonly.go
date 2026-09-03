package chat

import "time"

// defaultReadOnlyGraceHours is how long after a recruitment's scheduled end
// (recruitment_cards.expires_at, an absolute UTC instant derived from the JST
// available_date + end_time) an accepted chat still accepts new messages and
// realtime connections. Past this window the chat is history/read-only even
// though matches.status is still 'accepted'. Configurable per deployment via
// CHAT_READONLY_GRACE_HOURS; the number itself is a product decision.
const defaultReadOnlyGraceHours = 48

// ConfigureReadOnlyGrace sets the post-recruitment read-only grace window in
// hours. A negative value leaves the current setting in place; zero makes a
// chat read-only exactly at the recruitment's scheduled end.
func (s *Service) ConfigureReadOnlyGrace(hours int) {
	if s != nil && hours >= 0 {
		s.readOnlyGrace = time.Duration(hours) * time.Hour
	}
}

// ReadOnlyGrace reports the active post-recruitment read-only grace window.
func (s *Service) ReadOnlyGrace() time.Duration {
	if s == nil {
		return 0
	}
	return s.readOnlyGrace
}

// chatWriteClosed reports whether an accepted chat has passed its writable
// window: the recruitment's scheduled end plus the read-only grace. A blank or
// unparseable cardExpiresAt fails open (writable) because recruitment_cards
// always stores a normalized RFC3339 instant and a corrupt value must not
// silently freeze a live chat.
func chatWriteClosed(cardExpiresAt string, grace time.Duration, now time.Time) bool {
	scheduledEnd, err := time.Parse(time.RFC3339Nano, cardExpiresAt)
	if err != nil {
		return false
	}
	return now.After(scheduledEnd.Add(grace))
}

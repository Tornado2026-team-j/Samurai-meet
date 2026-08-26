package matching

import "time"

type CardStatus string

const (
	CardStatusDraft   CardStatus = "draft"
	CardStatusOpen    CardStatus = "open"
	CardStatusMatched CardStatus = "matched"
	CardStatusClosed  CardStatus = "closed"
	CardStatusExpired CardStatus = "expired"
)

type MatchStatus string

const (
	MatchStatusPending   MatchStatus = "pending"
	MatchStatusAccepted  MatchStatus = "accepted"
	MatchStatusRejected  MatchStatus = "rejected"
	MatchStatusBlocked   MatchStatus = "blocked"
	MatchStatusExpired   MatchStatus = "expired"
	MatchStatusCompleted MatchStatus = "completed"
)

// RecruitmentCard is the minimal persisted shape needed to gate matching and
// chat. Location-radius search (PostGIS) and the draft/publish workflow are
// deferred; cards are created directly in the open state.
type RecruitmentCard struct {
	ID            string     `json:"id"`
	OwnerUserID   string     `json:"owner_user_id"`
	Activity      string     `json:"activity"`
	LocationLabel string     `json:"location_label,omitempty"`
	AvailableDate string     `json:"available_date"`
	StartTime     string     `json:"start_time"`
	DurationHours int        `json:"duration_hours"`
	DistanceKm    int        `json:"distance_km"`
	Status        CardStatus `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// Match records that a user sent interest in another user's recruitment
// card, and whether the card owner has accepted it. Chat access is gated on
// Status == MatchStatusAccepted.
type Match struct {
	ID                string      `json:"id"`
	RecruitmentCardID string      `json:"recruitment_card_id"`
	OwnerUserID       string      `json:"owner_user_id"`
	InterestedUserID  string      `json:"interested_user_id"`
	Status            MatchStatus `json:"status"`
	CreatedAt         time.Time   `json:"created_at"`
	UpdatedAt         time.Time   `json:"updated_at"`
}

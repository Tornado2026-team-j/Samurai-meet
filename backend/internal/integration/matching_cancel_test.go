package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
)

// TestCancelAcceptedMatch covers the chat-screen "decline" path: once a match
// is accepted, either participant can cancel it, the recruitment card slot is
// freed, and the other participant is notified.
func TestCancelAcceptedMatch(t *testing.T) {
	database := openIsolatedDatabase(t)
	now := time.Now().UTC().Truncate(time.Second)
	jst := time.FixedZone("Asia/Tokyo", 9*60*60)
	availableDate := now.In(jst).AddDate(0, 0, 1).Format("2006-01-02")
	ctx := context.Background()
	travelerID := randomID(t)
	guideID := randomID(t)
	outsiderID := randomID(t)
	createdAt := now.Format(time.RFC3339Nano)

	for _, user := range []struct {
		id, googleID, displayName, countryCode string
	}{
		{travelerID, "cancel-traveler-" + travelerID, "Alex", "US"},
		{guideID, "cancel-guide-" + guideID, "Mika", "JP"},
		{outsiderID, "cancel-outsider-" + outsiderID, "Noah", "CA"},
	} {
		if _, err := database.Exec(`
			INSERT INTO users (id,google_subject_id,display_name,status,created_at,updated_at)
			VALUES ($1,$2,$3,'active',$4,$4)`, user.id, user.googleID, user.displayName, createdAt); err != nil {
			t.Fatal(err)
		}
		if _, err := database.Exec(`
			INSERT INTO profiles (user_id,name,nationality_code,bio,created_at,updated_at)
			VALUES ($1,$2,$3,'bio',$4,$4)`, user.id, user.displayName, user.countryCode, createdAt); err != nil {
			t.Fatal(err)
		}
	}

	notifications := notification.NewService(database)
	service := matching.NewService(database, notifications)

	card, err := service.CreateRecruitment(ctx, travelerID, matching.RecruitmentInput{
		Category:           "Places",
		AvailableDate:      availableDate,
		StartTime:          "18:00",
		EndTime:            "20:00",
		Timezone:           "Asia/Tokyo",
		Keywords:           []string{"local"},
		Description:        "Show me a quiet neighborhood.",
		VisibilityRadiusKM: 3,
		ParticipantLimit:   1,
		Status:             "open",
	}, now)
	if err != nil {
		t.Fatalf("CreateRecruitment() error = %v", err)
	}

	interest, err := service.SendInterest(ctx, guideID, card.ID, now)
	if err != nil {
		t.Fatalf("SendInterest() error = %v", err)
	}
	if _, err := service.AcceptMatch(ctx, travelerID, interest.ID, now.Add(time.Minute)); err != nil {
		t.Fatalf("AcceptMatch() error = %v", err)
	}
	filled, err := service.GetRecruitment(ctx, travelerID, card.ID, now.Add(time.Minute))
	if err != nil || filled.Status != "matched" {
		t.Fatalf("card after accept = %+v err=%v", filled, err)
	}

	if _, err := service.CancelMatch(ctx, outsiderID, interest.ID, now.Add(2*time.Minute)); !errors.Is(err, matching.ErrForbidden) {
		t.Fatalf("outsider cancel error = %v, want ErrForbidden", err)
	}

	cancelled, err := service.CancelMatch(ctx, guideID, interest.ID, now.Add(3*time.Minute))
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("CancelMatch() = %+v err=%v", cancelled, err)
	}

	reopened, err := service.GetRecruitment(ctx, travelerID, card.ID, now.Add(3*time.Minute))
	if err != nil || reopened.Status != "open" {
		t.Fatalf("card after cancel = %+v err=%v", reopened, err)
	}

	ownerNotifications, err := service.ListMatches(ctx, travelerID, matching.MatchListParams{Role: "owner"}, now.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("ListMatches() error = %v", err)
	}
	if len(ownerNotifications) != 1 || ownerNotifications[0].Status != "cancelled" {
		t.Fatalf("owner match view after cancel = %+v", ownerNotifications)
	}
	notes, err := notifications.List(ctx, travelerID, notification.ListParams{Limit: 10}, now.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("notifications list error = %v", err)
	}
	if !hasNotification(notes, notification.TypeApplicationWithdrawn, interest.ID) {
		t.Fatalf("owner was not notified of cancellation: %+v", notes)
	}

	if _, err := service.CancelMatch(ctx, guideID, interest.ID, now.Add(4*time.Minute)); !errors.Is(err, matching.ErrInvalidState) {
		t.Fatalf("second cancel error = %v, want ErrInvalidState", err)
	}
}

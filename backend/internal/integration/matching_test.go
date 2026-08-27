package integration

import (
	"context"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
)

func TestRecruitmentMatchingLifecycle(t *testing.T) {
	database := openIsolatedDatabase(t)
	now := time.Date(2026, time.August, 26, 8, 0, 0, 0, time.UTC)
	ctx := context.Background()
	travelerID := randomID(t)
	guideID := randomID(t)
	createdAt := now.Format(time.RFC3339Nano)

	for _, user := range []struct {
		id          string
		googleID    string
		displayName string
		countryCode string
		bio         string
	}{
		{id: travelerID, googleID: "matching-traveler-" + travelerID, displayName: "Alex", countryCode: "US", bio: "I want to explore Tokyo."},
		{id: guideID, googleID: "matching-guide-" + guideID, displayName: "Mika", countryCode: "JP", bio: "I can show you local places."},
	} {
		if _, err := database.Exec(`
			INSERT INTO users (id,google_subject_id,display_name,status,created_at,updated_at)
			VALUES ($1,$2,$3,'active',$4,$4)`, user.id, user.googleID, user.displayName, createdAt); err != nil {
			t.Fatal(err)
		}
		if _, err := database.Exec(`
			INSERT INTO profiles (user_id,name,nationality_code,bio,created_at,updated_at)
			VALUES ($1,$2,$3,$4,$5,$5)`, user.id, user.displayName, user.countryCode, user.bio, createdAt); err != nil {
			t.Fatal(err)
		}
	}

	notifications := notification.NewService(database)
	service := matching.NewService(database, notifications)
	cardLatitude, cardLongitude := 35.681236, 139.767125
	card, err := service.CreateRecruitment(ctx, travelerID, matching.RecruitmentInput{
		Category:           "Places",
		AvailableDate:      "2026-08-27",
		StartTime:          "18:00",
		EndTime:            "20:00",
		Timezone:           "Asia/Tokyo",
		Keywords:           []string{"local", "culture"},
		Description:        "Please show me a quiet local neighborhood.",
		VisibilityRadiusKM: 3,
		Latitude:           &cardLatitude,
		Longitude:          &cardLongitude,
		Status:             "open",
	}, now)
	if err != nil {
		t.Fatalf("CreateRecruitment() error = %v", err)
	}
	if card.Status != "open" || card.ID == "" {
		t.Fatalf("created card = %+v", card)
	}

	guideLatitude, guideLongitude := 35.6812, 139.7672
	found, err := service.SearchRecruitments(ctx, guideID, matching.SearchParams{
		AvailableDate: "2026-08-27",
		RadiusKM:      3,
		Latitude:      &guideLatitude,
		Longitude:     &guideLongitude,
	}, now)
	if err != nil {
		t.Fatalf("SearchRecruitments() error = %v", err)
	}
	if len(found) != 1 || found[0].ID != card.ID || found[0].DistanceBand != "within_1_km" {
		t.Fatalf("search result = %+v", found)
	}

	interest, err := service.SendInterest(ctx, guideID, card.ID, now)
	if err != nil {
		t.Fatalf("SendInterest() error = %v", err)
	}
	if interest.Status != "pending" {
		t.Fatalf("interest = %+v", interest)
	}
	ownerNotifications, err := notifications.List(ctx, travelerID, notification.ListParams{Limit: 10}, now)
	if err != nil {
		t.Fatalf("owner notifications = %v", err)
	}
	if !hasNotification(ownerNotifications, notification.TypeNewApplication, interest.ID) {
		t.Fatalf("new application notification = %+v", ownerNotifications)
	}

	applications, err := service.ListMatches(ctx, travelerID, matching.MatchListParams{Role: "owner", Status: "pending"}, now)
	if err != nil {
		t.Fatalf("ListMatches() error = %v", err)
	}
	if len(applications) != 1 || applications[0].OtherUser.Name != "Mika" || applications[0].Recruitment.ID != card.ID {
		t.Fatalf("applications = %+v", applications)
	}

	accepted, err := service.AcceptMatch(ctx, travelerID, interest.ID, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("AcceptMatch() error = %v", err)
	}
	if accepted.Status != "accepted" || accepted.MatchedAt == "" {
		t.Fatalf("accepted = %+v", accepted)
	}
	view, err := service.GetMatch(ctx, guideID, interest.ID)
	if err != nil {
		t.Fatalf("GetMatch() error = %v", err)
	}
	if view.Status != "accepted" || view.OtherUser.Name != "Alex" || view.Recruitment.ID != card.ID {
		t.Fatalf("match view = %+v", view)
	}
	guideNotifications, err := notifications.List(ctx, guideID, notification.ListParams{Limit: 10}, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("guide notifications = %v", err)
	}
	if !hasNotification(guideNotifications, notification.TypeMatchConfirmed, interest.ID) {
		t.Fatalf("match confirmed notification = %+v", guideNotifications)
	}

	completed, err := service.CompleteMatch(ctx, guideID, interest.ID, now.Add(2*time.Hour))
	if err != nil {
		t.Fatalf("CompleteMatch() error = %v", err)
	}
	if completed.Status != "completed" {
		t.Fatalf("completed = %+v", completed)
	}

	secondCard, err := service.CreateRecruitment(ctx, travelerID, matching.RecruitmentInput{
		Category:           "Food",
		AvailableDate:      "2026-08-28",
		StartTime:          "12:00",
		EndTime:            "13:00",
		Timezone:           "Asia/Tokyo",
		Keywords:           []string{"food"},
		Description:        "Lunch together.",
		VisibilityRadiusKM: 1,
		Status:             "open",
	}, now)
	if err != nil {
		t.Fatalf("second CreateRecruitment() error = %v", err)
	}
	secondInterest, err := service.SendInterest(ctx, guideID, secondCard.ID, now)
	if err != nil {
		t.Fatalf("second SendInterest() error = %v", err)
	}
	rejected, err := service.RejectMatch(ctx, travelerID, secondInterest.ID, now)
	if err != nil {
		t.Fatalf("RejectMatch() error = %v", err)
	}
	if rejected.Status != "rejected" {
		t.Fatalf("rejected = %+v", rejected)
	}
	guideNotifications, err = notifications.List(ctx, guideID, notification.ListParams{Limit: 10}, now.Add(2*time.Hour))
	if err != nil {
		t.Fatalf("guide notifications after rejection = %v", err)
	}
	if !hasNotification(guideNotifications, notification.TypeApplicationRejected, secondInterest.ID) {
		t.Fatalf("application rejected notification = %+v", guideNotifications)
	}
}

func hasNotification(items []notification.Notification, kind notification.Type, targetID string) bool {
	for _, item := range items {
		if item.Type == kind && item.TargetID == targetID {
			return true
		}
	}
	return false
}

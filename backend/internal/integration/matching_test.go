package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/meeting"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
)

func TestRecruitmentMatchingLifecycle(t *testing.T) {
	database := openIsolatedDatabase(t)
	now := time.Now().UTC().Truncate(time.Second)
	firstDate := now.In(time.FixedZone("Asia/Tokyo", 9*60*60)).AddDate(0, 0, 1).Format("2006-01-02")
	secondDate := now.In(time.FixedZone("Asia/Tokyo", 9*60*60)).AddDate(0, 0, 2).Format("2006-01-02")
	withdrawDate := now.In(time.FixedZone("Asia/Tokyo", 9*60*60)).AddDate(0, 0, 3).Format("2006-01-02")
	ctx := context.Background()
	travelerID := randomID(t)
	guideID := randomID(t)
	outsiderID := randomID(t)
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
		{id: outsiderID, googleID: "matching-outsider-" + outsiderID, displayName: "Noah", countryCode: "CA", bio: "I am not part of this match."},
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
		AvailableDate:      firstDate,
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
		AvailableDate: firstDate,
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
	duplicate, err := service.SendInterest(ctx, guideID, card.ID, now.Add(time.Second))
	if !errors.Is(err, matching.ErrDuplicateInterest) || duplicate.ID != interest.ID || duplicate.Status != interest.Status {
		t.Fatalf("duplicate interest = %+v, err=%v", duplicate, err)
	}
	owned, err := service.ListOwnedRecruitments(ctx, travelerID, now)
	if err != nil {
		t.Fatalf("ListOwnedRecruitments() error = %v", err)
	}
	if len(owned) != 1 || owned[0].ID != card.ID {
		t.Fatalf("owned recruitments = %+v", owned)
	}
	guideOwned, err := service.ListOwnedRecruitments(ctx, guideID, now)
	if err != nil {
		t.Fatalf("other user's recruitments error = %v", err)
	}
	if len(guideOwned) != 0 {
		t.Fatalf("other user's recruitments = %+v", guideOwned)
	}
	changedDescription := "The owner cannot be changed by an applicant."
	if _, err := service.UpdateRecruitment(ctx, guideID, card.ID, matching.RecruitmentPatch{Description: &changedDescription}, now); !errors.Is(err, matching.ErrForbidden) {
		t.Fatalf("other user's update error = %v, want ErrForbidden", err)
	}
	ownerCard, err := service.GetRecruitment(ctx, travelerID, card.ID, now)
	if err != nil || ownerCard.Description != card.Description || ownerCard.Status != "open" {
		t.Fatalf("unauthorized update changed recruitment: card=%+v err=%v", ownerCard, err)
	}
	if err := service.CloseRecruitment(ctx, guideID, card.ID, now); !errors.Is(err, matching.ErrRecruitmentNotFound) {
		t.Fatalf("other user's close error = %v, want ErrRecruitmentNotFound", err)
	}
	ownerCard, err = service.GetRecruitment(ctx, travelerID, card.ID, now)
	if err != nil || ownerCard.Status != "open" {
		t.Fatalf("unauthorized close changed recruitment: card=%+v err=%v", ownerCard, err)
	}
	if _, err := service.SendInterest(ctx, travelerID, card.ID, now); !errors.Is(err, matching.ErrForbidden) {
		t.Fatalf("owner interest error = %v, want ErrForbidden", err)
	}
	if _, err := service.GetMatch(ctx, outsiderID, interest.ID); !errors.Is(err, matching.ErrMatchNotFound) {
		t.Fatalf("outsider get match error = %v, want ErrMatchNotFound", err)
	}
	if _, err := service.AcceptMatch(ctx, guideID, interest.ID, now); !errors.Is(err, matching.ErrForbidden) {
		t.Fatalf("requester accept error = %v, want ErrForbidden", err)
	}
	if _, err := service.RejectMatch(ctx, guideID, interest.ID, now); !errors.Is(err, matching.ErrForbidden) {
		t.Fatalf("requester reject error = %v, want ErrForbidden", err)
	}
	pendingView, err := service.GetMatch(ctx, guideID, interest.ID)
	if err != nil || pendingView.Status != "pending" {
		t.Fatalf("unauthorized match actions changed state: match=%+v err=%v", pendingView, err)
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
	if _, err := service.CompleteMatch(ctx, outsiderID, interest.ID, now.Add(time.Minute)); !errors.Is(err, matching.ErrForbidden) {
		t.Fatalf("outsider complete error = %v, want ErrForbidden", err)
	}
	acceptedView, err := service.GetMatch(ctx, travelerID, interest.ID)
	if err != nil || acceptedView.Status != "accepted" {
		t.Fatalf("unauthorized completion changed state: match=%+v err=%v", acceptedView, err)
	}
	meetingService := meeting.NewService(database)
	if _, err := meetingService.Create(ctx, outsiderID, interest.ID, "", now.Add(time.Minute)); !errors.Is(err, meeting.ErrMeetingForbidden) {
		t.Fatalf("outsider meeting creation error = %v, want ErrMeetingForbidden", err)
	}
	var meetingCount int
	if err := database.QueryRow(`SELECT COUNT(*) FROM meeting_sessions WHERE match_id=$1`, interest.ID).Scan(&meetingCount); err != nil || meetingCount != 0 {
		t.Fatalf("unauthorized meeting creation changed state: count=%d err=%v", meetingCount, err)
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
	var foundMatchConfirmedMetadata bool
	for _, item := range guideNotifications {
		if item.Type == notification.TypeMatchConfirmed &&
			item.TargetID == interest.ID &&
			item.RecruitmentID == card.ID &&
			item.Destination == notification.DestinationGuideDetail {
			foundMatchConfirmedMetadata = true
		}
	}
	if !foundMatchConfirmedMetadata {
		t.Fatalf("match confirmed notification metadata = %+v", guideNotifications)
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
		AvailableDate:      secondDate,
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
	var foundRejectedMetadata bool
	for _, item := range guideNotifications {
		if item.Type == notification.TypeApplicationRejected &&
			item.TargetID == secondInterest.ID &&
			item.RecruitmentID == secondCard.ID &&
			item.Destination == notification.DestinationApplicationDetail {
			foundRejectedMetadata = true
		}
	}
	if !foundRejectedMetadata {
		t.Fatalf("application rejected notification metadata = %+v", guideNotifications)
	}

	updatedDescription := "Lunch with a local host."
	updatedCard, err := service.UpdateRecruitment(ctx, travelerID, secondCard.ID, matching.RecruitmentPatch{Description: &updatedDescription}, now)
	if err != nil {
		t.Fatalf("owner UpdateRecruitment() error = %v", err)
	}
	if updatedCard.Description != updatedDescription {
		t.Fatalf("updated card description = %q", updatedCard.Description)
	}
	if err := service.CloseRecruitment(ctx, travelerID, secondCard.ID, now); err != nil {
		t.Fatalf("owner CloseRecruitment() error = %v", err)
	}
	if _, err := service.UpdateRecruitment(ctx, travelerID, secondCard.ID, matching.RecruitmentPatch{Description: &updatedDescription}, now); !errors.Is(err, matching.ErrInvalidState) {
		t.Fatalf("closed recruitment update error = %v, want ErrInvalidState", err)
	}
	closedCards, err := service.ListOwnedRecruitments(ctx, travelerID, now)
	if err != nil {
		t.Fatalf("ListOwnedRecruitments() after close error = %v", err)
	}
	var foundClosed bool
	for _, item := range closedCards {
		if item.ID == secondCard.ID && item.Status == "closed" {
			foundClosed = true
		}
	}
	if !foundClosed {
		t.Fatalf("closed recruitment was not retained: %+v", closedCards)
	}

	withdrawCard, err := service.CreateRecruitment(ctx, travelerID, matching.RecruitmentInput{
		Category:           "Other",
		AvailableDate:      withdrawDate,
		StartTime:          "12:00",
		EndTime:            "13:00",
		Timezone:           "Asia/Tokyo",
		Keywords:           []string{"walk"},
		Description:        "A short walk.",
		VisibilityRadiusKM: 1,
		Status:             "open",
	}, now)
	if err != nil {
		t.Fatalf("withdraw card create error = %v", err)
	}
	withdrawInterest, err := service.SendInterest(ctx, guideID, withdrawCard.ID, now)
	if err != nil {
		t.Fatalf("withdraw interest create error = %v", err)
	}
	withdrawn, err := service.WithdrawInterest(ctx, guideID, withdrawInterest.ID, now.Add(time.Minute))
	if err != nil || withdrawn.Status != "cancelled" {
		t.Fatalf("withdrawn interest = %+v, err=%v", withdrawn, err)
	}
	if _, err := service.WithdrawInterest(ctx, travelerID, withdrawInterest.ID, now.Add(2*time.Minute)); !errors.Is(err, matching.ErrForbidden) {
		t.Fatalf("owner withdrawal error = %v, want ErrForbidden", err)
	}
	requesterHistory, err := service.ListMatches(ctx, guideID, matching.MatchListParams{Role: "requester"}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("requester history error = %v", err)
	}
	var foundWithdrawn bool
	for _, item := range requesterHistory {
		if item.ID == withdrawInterest.ID && item.Status == "cancelled" && item.OtherUser.Name == "Alex" {
			foundWithdrawn = true
		}
	}
	if !foundWithdrawn {
		t.Fatalf("withdrawn application missing from requester history: %+v", requesterHistory)
	}
	ownerHistory, err := service.ListMatches(ctx, travelerID, matching.MatchListParams{Role: "owner"}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("owner history error = %v", err)
	}
	var foundOwnerWithdrawn bool
	for _, item := range ownerHistory {
		if item.ID == withdrawInterest.ID && item.RecruitmentID == withdrawCard.ID && item.Status == "cancelled" {
			foundOwnerWithdrawn = true
		}
	}
	if !foundOwnerWithdrawn {
		t.Fatalf("withdrawn application missing from owner history: %+v", ownerHistory)
	}
	withdrawNotifications, err := notifications.List(ctx, travelerID, notification.ListParams{Limit: 20}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("withdraw notifications error = %v", err)
	}
	if !hasNotification(withdrawNotifications, notification.TypeApplicationWithdrawn, withdrawInterest.ID) {
		t.Fatalf("withdraw notification missing: %+v", withdrawNotifications)
	}
	var foundWithdrawNotification bool
	for _, item := range withdrawNotifications {
		if item.Type == notification.TypeApplicationWithdrawn &&
			item.TargetID == withdrawInterest.ID &&
			item.RecruitmentID == withdrawCard.ID &&
			item.Destination == notification.DestinationApplicants {
			foundWithdrawNotification = true
		}
	}
	if !foundWithdrawNotification {
		t.Fatalf("withdraw notification metadata = %+v", withdrawNotifications)
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

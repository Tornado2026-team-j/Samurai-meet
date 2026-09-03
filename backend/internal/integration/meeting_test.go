package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/meeting"
)

func TestMeetingResumeRequiresBothParticipants(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 3, 9, 0, 0, 0, time.UTC)
	stamp := now.Format(time.RFC3339Nano)

	ownerID := randomID(t)
	requesterID := randomID(t)
	insertMatchingTestUser(t, database, now, ownerID, "Meeting owner", "JP")
	insertMatchingTestUser(t, database, now, requesterID, "Meeting requester", "US")
	cardID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,description,visibility_radius_km,status,expires_at,created_at,updated_at)
		VALUES ($1,$2,'Food','2026-09-04','18:00','20:00','Asia/Tokyo','Resume consent test.',3,'matched',$3,$4,$4)`,
		cardID, ownerID, now.Add(48*time.Hour).Format(time.RFC3339Nano), stamp); err != nil {
		t.Fatal(err)
	}
	matchID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at)
		VALUES ($1,$2,$3,$4,'accepted',$5,$5,$5)`,
		matchID, cardID, requesterID, ownerID, stamp); err != nil {
		t.Fatal(err)
	}

	service := meeting.NewService(database)
	created, err := service.Create(ctx, ownerID, matchID, now.Add(2*time.Hour).Format(time.RFC3339Nano), now)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := service.Start(ctx, ownerID, created.ID, now.Add(time.Minute)); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if _, err := service.Cancel(ctx, requesterID, created.ID, now.Add(2*time.Minute)); err != nil {
		t.Fatalf("Cancel() error = %v", err)
	}

	first, err := service.Resume(ctx, ownerID, created.ID, now.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("first Resume() error = %v", err)
	}
	if first.Status != "cancelled" || !first.ResumeRequested {
		t.Fatalf("first resume = %+v, want cancelled with caller consent", first)
	}
	second, err := service.Resume(ctx, requesterID, created.ID, now.Add(4*time.Minute))
	if err != nil {
		t.Fatalf("second Resume() error = %v", err)
	}
	if second.Status != "planned" || second.ResumeRequested {
		t.Fatalf("second resume = %+v, want planned without pending consent", second)
	}

	var startedAt, endedAt, cancelledAt, ownerStartedAt, requesterStartedAt string
	if err := database.QueryRowContext(ctx, `
		SELECT COALESCE(started_at,''),COALESCE(ended_at,''),COALESCE(cancelled_at,''),
		       COALESCE(owner_started_at,''),COALESCE(requester_started_at,'')
		FROM meeting_sessions WHERE id=$1`, created.ID).Scan(&startedAt, &endedAt, &cancelledAt, &ownerStartedAt, &requesterStartedAt); err != nil {
		t.Fatal(err)
	}
	if startedAt != "" || endedAt != "" || cancelledAt != "" || ownerStartedAt != "" || requesterStartedAt != "" {
		t.Fatalf("resume did not reset prior consent state: started=%q ended=%q cancelled=%q owner=%q requester=%q", startedAt, endedAt, cancelledAt, ownerStartedAt, requesterStartedAt)
	}

	ownerStart, err := service.Start(ctx, ownerID, created.ID, now.Add(5*time.Minute))
	if err != nil || ownerStart.Status != "planned" {
		t.Fatalf("owner start after resume = %+v, %v; want planned until requester starts", ownerStart, err)
	}
	requesterStart, err := service.Start(ctx, requesterID, created.ID, now.Add(6*time.Minute))
	if err != nil || requesterStart.Status != "active" {
		t.Fatalf("requester start after resume = %+v, %v; want active after mutual start", requesterStart, err)
	}
	if _, err := service.Resume(ctx, ownerID, created.ID, now.Add(7*time.Minute)); !errors.Is(err, meeting.ErrMeetingInvalidState) {
		t.Fatalf("active meeting Resume() error = %v, want ErrMeetingInvalidState", err)
	}
}

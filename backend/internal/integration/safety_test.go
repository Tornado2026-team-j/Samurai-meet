package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/safety"
)

func TestSafetyReportAndBlock(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.August, 27, 9, 0, 0, 0, time.UTC)
	stamp := now.Format(time.RFC3339Nano)

	reporterID := randomID(t)
	targetID := randomID(t)
	for _, u := range []struct{ id, google string }{
		{reporterID, "safety-reporter-" + reporterID},
		{targetID, "safety-target-" + targetID},
	} {
		if _, err := database.ExecContext(ctx, `
			INSERT INTO users (id,google_subject_id,display_name,status,created_at,updated_at)
			VALUES ($1,$2,$3,'active',$4,$4)`, u.id, u.google, "User "+u.id[:6], stamp); err != nil {
			t.Fatal(err)
		}
	}

	svc := safety.NewService(database)

	report, err := svc.CreateReport(ctx, reporterID, safety.ReportInput{
		TargetType: "user", TargetID: targetID, Reason: "harassment", Comment: "repeated unwanted messages",
	}, now)
	if err != nil {
		t.Fatalf("CreateReport() error = %v", err)
	}
	if report.ID == "" || report.Status != "received" {
		t.Fatalf("report = %+v", report)
	}

	// a second report for the same open target is idempotent
	again, err := svc.CreateReport(ctx, reporterID, safety.ReportInput{
		TargetType: "user", TargetID: targetID, Reason: "dangerous", Comment: "changed my mind",
	}, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("CreateReport() repeat error = %v", err)
	}
	if again.ID != report.ID || again.Reason != "harassment" {
		t.Fatalf("repeat report should return the original, got %+v", again)
	}
	var count int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM reports WHERE reporter_user_id=$1`, reporterID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("reports stored = %d, want 1", count)
	}

	if _, err := svc.CreateReport(ctx, reporterID, safety.ReportInput{TargetType: "user", TargetID: reporterID, Reason: "other"}, now); !errors.Is(err, safety.ErrInvalidReport) {
		t.Fatalf("self report error = %v, want ErrInvalidReport", err)
	}
	if _, err := svc.CreateReport(ctx, reporterID, safety.ReportInput{TargetType: "user", TargetID: randomID(t), Reason: "other"}, now); !errors.Is(err, safety.ErrTargetNotFound) {
		t.Fatalf("unknown target error = %v, want ErrTargetNotFound", err)
	}

	// blocking is idempotent and visible in the list
	if err := svc.BlockUser(ctx, reporterID, targetID, now); err != nil {
		t.Fatalf("BlockUser() error = %v", err)
	}
	if err := svc.BlockUser(ctx, reporterID, targetID, now); err != nil {
		t.Fatalf("BlockUser() repeat error = %v", err)
	}
	blocked, err := svc.ListBlocks(ctx, reporterID)
	if err != nil {
		t.Fatalf("ListBlocks() error = %v", err)
	}
	if len(blocked) != 1 || blocked[0].UserID != targetID {
		t.Fatalf("blocked list = %+v", blocked)
	}

	// the block is enforced by matching: the target cannot send interest
	matchingSvc := matching.NewService(database)
	cardID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,visibility_radius_km,status,expires_at,created_at,updated_at)
		VALUES ($1,$2,'Food','2026-08-28','18:00','20:00','Asia/Tokyo',3,'open',$3,$4,$4)`,
		cardID, reporterID, now.Add(48*time.Hour).Format(time.RFC3339Nano), stamp); err != nil {
		t.Fatal(err)
	}
	if _, err := matchingSvc.SendInterest(ctx, targetID, cardID, now); !errors.Is(err, matching.ErrBlocked) {
		t.Fatalf("blocked interest error = %v, want matching.ErrBlocked", err)
	}

	// unblock removes it
	if err := svc.Unblock(ctx, reporterID, targetID); err != nil {
		t.Fatalf("Unblock() error = %v", err)
	}
	if err := svc.Unblock(ctx, reporterID, targetID); !errors.Is(err, safety.ErrBlockNotFound) {
		t.Fatalf("second Unblock error = %v, want ErrBlockNotFound", err)
	}
}

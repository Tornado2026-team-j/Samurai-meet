package safety

import (
	"context"
	"testing"
	"time"
)

func TestReportTargetAndReasonAllowlists(t *testing.T) {
	for _, target := range []string{"user", "recruitment_card", "message", "photo"} {
		if !reportTargetTypes[target] {
			t.Errorf("target type %q should be allowed", target)
		}
	}
	if reportTargetTypes["session"] || reportTargetTypes[""] {
		t.Error("unexpected target type accepted")
	}
	for _, reason := range []string{"nuisance", "harassment", "impersonation", "inappropriate_photo", "dangerous", "other"} {
		if !reportReasons[reason] {
			t.Errorf("reason %q should be allowed", reason)
		}
	}
	if reportReasons["spam"] || reportReasons[""] {
		t.Error("unexpected reason accepted")
	}
}

func TestNilServiceIsInert(t *testing.T) {
	var s *Service
	if _, err := s.CreateReport(context.Background(), "u", ReportInput{TargetType: "user", TargetID: "x", Reason: "other"}, time.Time{}); err == nil {
		t.Error("nil service CreateReport should error")
	}
	if err := s.BlockUser(context.Background(), "u", "v", time.Time{}); err == nil {
		t.Error("nil service BlockUser should error")
	}
}

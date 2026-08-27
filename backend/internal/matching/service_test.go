package matching

import (
	"errors"
	"math"
	"testing"
	"time"
)

func TestNormalizeRecruitmentInput(t *testing.T) {
	now := time.Date(2026, time.August, 26, 8, 0, 0, 0, time.UTC)
	input := RecruitmentInput{
		Category:           "Food",
		AvailableDate:      "2026-08-27",
		StartTime:          "18:00",
		EndTime:            "20:00",
		Timezone:           "Asia/Tokyo",
		Keywords:           []string{" 食事 ", "食事", "日本語"},
		Description:        "駅の近くで交流しましょう",
		VisibilityRadiusKM: 3,
		Status:             "open",
	}

	normalized, expiresAt, err := normalizeRecruitmentInput(input, now)
	if err != nil {
		t.Fatalf("normalizeRecruitmentInput() error = %v", err)
	}
	if got, want := normalized.Keywords, []string{"食事", "日本語"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("keywords = %#v, want %#v", got, want)
	}
	if normalized.Status != "open" || expiresAt == "" {
		t.Fatalf("normalized status/expiresAt = %q/%q", normalized.Status, expiresAt)
	}

	invalid := input
	invalid.VisibilityRadiusKM = 2
	if _, _, err := normalizeRecruitmentInput(invalid, now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid radius error = %v, want ErrInvalidInput", err)
	}

	invalid = input
	invalid.EndTime = "17:00"
	if _, _, err := normalizeRecruitmentInput(invalid, now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid time error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeSearchParams(t *testing.T) {
	latitude, longitude := 35.681236, 139.767125
	params, err := normalizeSearchParams(SearchParams{
		Keywords:  []string{" food ", "food"},
		Latitude:  &latitude,
		Longitude: &longitude,
	})
	if err != nil {
		t.Fatalf("normalizeSearchParams() error = %v", err)
	}
	if params.Limit != defaultSearchLimit || len(params.Keywords) != 1 || params.Keywords[0] != "food" {
		t.Fatalf("normalized params = %#v", params)
	}

	invalid := SearchParams{Latitude: &latitude}
	if _, err := normalizeSearchParams(invalid); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("partial coordinates error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeMatchListParams(t *testing.T) {
	params, err := normalizeMatchListParams(MatchListParams{Role: "owner", Status: "pending"})
	if err != nil {
		t.Fatalf("normalizeMatchListParams() error = %v", err)
	}
	if params.Role != "owner" || params.Status != "pending" || params.Limit != defaultSearchLimit {
		t.Fatalf("normalized match params = %#v", params)
	}

	for _, invalid := range []MatchListParams{
		{Role: "admin"},
		{Status: "unknown"},
		{Limit: -1},
	} {
		if _, err := normalizeMatchListParams(invalid); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid params %#v error = %v, want ErrInvalidInput", invalid, err)
		}
	}
}

func TestHaversineAndDistanceBandDoNotExposeExactDistance(t *testing.T) {
	if got := haversineKM(0, 0, 0, 1); math.Abs(got-111.195) > 0.2 {
		t.Fatalf("one degree distance = %f km", got)
	}
	for _, test := range []struct {
		distance  float64
		available bool
		want      string
	}{
		{distance: 0.5, available: true, want: "within_1_km"},
		{distance: 2, available: true, want: "within_3_km"},
		{distance: 4, available: true, want: "within_5_km"},
		{distance: 0, available: false, want: ""},
	} {
		if got := distanceBand(test.distance, test.available); got != test.want {
			t.Errorf("distanceBand(%v, %v) = %q, want %q", test.distance, test.available, got, test.want)
		}
	}
}

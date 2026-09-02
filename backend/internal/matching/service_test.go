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
	if normalized.Timezone != recruitmentTimezone {
		t.Fatalf("normalized timezone = %q, want %q", normalized.Timezone, recruitmentTimezone)
	}
	if want := "2026-08-26T09:00:00Z"; expiresAt != want {
		t.Fatalf("expiresAt = %q, want %q", expiresAt, want)
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

	invalid = input
	invalid.Description = " \t"
	if _, _, err := normalizeRecruitmentInput(invalid, now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty description error = %v, want ErrInvalidInput", err)
	}

	for _, category := range []string{"Places", "Activity", "Other"} {
		valid := input
		valid.Category = category
		if _, _, err := normalizeRecruitmentInput(valid, now); err != nil {
			t.Errorf("category %q error = %v, want nil", category, err)
		}
	}
	invalid = input
	invalid.Category = "Heritage"
	if _, _, err := normalizeRecruitmentInput(invalid, now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("retired category error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeRecruitmentInputDefaultsToJSTAndRejectsOtherTimezones(t *testing.T) {
	now := time.Date(2026, time.August, 26, 8, 0, 0, 0, time.UTC)
	base := RecruitmentInput{
		Category:           "Food",
		AvailableDate:      "2026-08-27",
		StartTime:          "18:00",
		EndTime:            "20:00",
		Keywords:           []string{"食事"},
		Description:        "駅の近くで交流しましょう",
		VisibilityRadiusKM: 3,
	}

	withoutTimezone := base
	normalized, _, err := normalizeRecruitmentInput(withoutTimezone, now)
	if err != nil {
		t.Fatalf("empty timezone error = %v", err)
	}
	if normalized.Timezone != recruitmentTimezone {
		t.Fatalf("empty timezone normalized to %q, want %q", normalized.Timezone, recruitmentTimezone)
	}

	for _, test := range []struct {
		status   string
		timezone string
	}{
		{status: "open", timezone: "UTC"},
		{status: "draft", timezone: "UTC"},
		{status: "closed", timezone: "UTC"},
		{status: "open", timezone: "America/Los_Angeles"},
	} {
		invalid := base
		invalid.Status = test.status
		invalid.Timezone = test.timezone
		if _, _, err := normalizeRecruitmentInput(invalid, now); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("timezone %q with status %q error = %v, want ErrInvalidInput", test.timezone, test.status, err)
		}
	}
}

func TestRecruitmentExpiryUsesJSTStartMinus24Hours(t *testing.T) {
	input := RecruitmentInput{
		Category:           "Food",
		AvailableDate:      "2026-08-27",
		StartTime:          "18:00",
		EndTime:            "20:00",
		Timezone:           recruitmentTimezone,
		Keywords:           []string{"食事"},
		Description:        "駅の近くで交流しましょう",
		VisibilityRadiusKM: 3,
		Status:             "open",
	}

	justBeforeDeadline := time.Date(2026, time.August, 26, 8, 59, 59, 0, time.UTC)
	_, expiresAt, err := normalizeRecruitmentInput(input, justBeforeDeadline)
	if err != nil {
		t.Fatalf("just before JST start minus 24h error = %v", err)
	}
	if !beforeExpiry(expiresAt, justBeforeDeadline) {
		t.Fatalf("beforeExpiry(%q, %s) = false, want true", expiresAt, justBeforeDeadline.Format(time.RFC3339))
	}

	atDeadline := time.Date(2026, time.August, 26, 9, 0, 0, 0, time.UTC)
	if beforeExpiry(expiresAt, atDeadline) {
		t.Fatalf("beforeExpiry(%q, %s) = true, want false", expiresAt, atDeadline.Format(time.RFC3339))
	}
	if _, _, err := normalizeRecruitmentInput(input, atDeadline); !errors.Is(err, ErrRecruitmentExpired) {
		t.Fatalf("at JST start minus 24h error = %v, want ErrRecruitmentExpired", err)
	}
}

func TestNormalizeRecruitmentInputAllowsPastDraft(t *testing.T) {
	now := time.Date(2026, time.August, 26, 8, 0, 0, 0, time.UTC)
	input := RecruitmentInput{
		Category:           "Food",
		AvailableDate:      "2026-08-25",
		StartTime:          "18:00",
		EndTime:            "20:00",
		Timezone:           recruitmentTimezone,
		Keywords:           []string{"食事"},
		Description:        "駅の近くで交流しましょう",
		VisibilityRadiusKM: 3,
		Status:             "draft",
	}

	normalized, expiresAt, err := normalizeRecruitmentInput(input, now)
	if err != nil {
		t.Fatalf("past draft error = %v, want nil", err)
	}
	if normalized.Status != "draft" || expiresAt == "" {
		t.Fatalf("normalized draft status/expiresAt = %q/%q", normalized.Status, expiresAt)
	}

	input.Status = "open"
	if _, _, err := normalizeRecruitmentInput(input, now); !errors.Is(err, ErrRecruitmentExpired) {
		t.Fatalf("past open error = %v, want ErrRecruitmentExpired", err)
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

	for _, category := range []string{"Food", "Places", "Activity", "Other"} {
		params, err := normalizeSearchParams(SearchParams{Category: category})
		if err != nil || params.Category != category {
			t.Errorf("category %q normalized params = %#v, error = %v", category, params, err)
		}
	}
	if _, err := normalizeSearchParams(SearchParams{Category: "Heritage"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("retired search category error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeSearchParamsDateRange(t *testing.T) {
	valid, err := normalizeSearchParams(SearchParams{AvailableFrom: "2026-09-01", AvailableTo: "2026-11-01"})
	if err != nil {
		t.Fatalf("valid date range rejected: %v", err)
	}
	if valid.AvailableFrom != "2026-09-01" || valid.AvailableTo != "2026-11-01" {
		t.Fatalf("date range changed: %#v", valid)
	}
	if _, err := normalizeSearchParams(SearchParams{AvailableFrom: "2026-12-31", AvailableTo: "2027-03-03"}); err != nil {
		t.Fatalf("valid end-of-month date range rejected: %v", err)
	}
	for _, invalid := range []SearchParams{
		{AvailableFrom: "2026-09-30", AvailableTo: "2026-09-01"},
		{AvailableFrom: "2026-09-01", AvailableTo: "2026-11-02"},
		{AvailableFrom: "2026-12-31", AvailableTo: "2027-03-04"},
		{AvailableFrom: "2026-09-01"},
	} {
		if _, err := normalizeSearchParams(invalid); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid date range %#v returned %v", invalid, err)
		}
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
	if _, err := normalizeMatchListParams(MatchListParams{Role: "requester", Status: "cancelled"}); err != nil {
		t.Fatalf("cancelled status error = %v", err)
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

package places

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSearchUsesGooglePlacesAutocompleteAndDetails(t *testing.T) {
	var requestedBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Goog-Api-Key"); got != "test-places-key" {
			t.Fatalf("api key header = %q", got)
		}
		switch r.URL.Path {
		case "/autocomplete":
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			fieldMask := r.Header.Get("X-Goog-FieldMask")
			for _, field := range []string{"suggestions.placePrediction.placeId", "suggestions.placePrediction.structuredFormat", "suggestions.placePrediction.types"} {
				if !strings.Contains(fieldMask, field) {
					t.Fatalf("autocomplete field mask %q does not contain %q", fieldMask, field)
				}
			}
			if err := json.NewDecoder(r.Body).Decode(&requestedBody); err != nil {
				t.Fatalf("decode request body: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"suggestions": [
					{
						"placePrediction": {
							"placeId": "ChIJVVVld8ngAGARi9mE-a6e9mc",
							"text": {"text": "大阪府大阪市中央区大阪城 大阪城公園"},
							"structuredFormat": {
								"mainText": {"text": "大阪城公園"},
								"secondaryText": {"text": "大阪府大阪市中央区大阪城"}
							},
							"types": ["establishment", "park", "point_of_interest", "tourist_attraction"]
						}
					}
				]
			}`))
		case "/places/ChIJVVVld8ngAGARi9mE-a6e9mc":
			if r.Method != http.MethodGet {
				t.Fatalf("details method = %s, want GET", r.Method)
			}
			fieldMask := r.Header.Get("X-Goog-FieldMask")
			for _, field := range []string{"id", "displayName", "formattedAddress", "location"} {
				if !strings.Contains(fieldMask, field) {
					t.Fatalf("details field mask %q does not contain %q", fieldMask, field)
				}
			}
			if got := r.URL.Query().Get("languageCode"); got != "ja" {
				t.Fatalf("details languageCode = %q, want ja", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"id": "ChIJVVVld8ngAGARi9mE-a6e9mc",
				"displayName": {"text": "大阪城公園"},
				"formattedAddress": "大阪府大阪市中央区大阪城",
				"location": {"latitude": 34.687315, "longitude": 135.526201}
			}`))
		default:
			t.Fatalf("unexpected path = %s", r.URL.Path)
		}
	}))
	defer server.Close()

	latitude, longitude := 34.6937, 135.5023
	suggestions, err := NewService(
		"test-places-key",
		WithEndpoint(server.URL+"/autocomplete"),
		WithDetailsEndpoint(server.URL+"/places/%s?languageCode=%s"),
	).Search(context.Background(), SearchInput{
		Query:     "大阪城公園",
		Language:  "ja",
		Latitude:  &latitude,
		Longitude: &longitude,
		Limit:     5,
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if got := requestedBody["input"]; got != "大阪城公園" {
		t.Fatalf("input = %#v", got)
	}
	if got := requestedBody["languageCode"]; got != "ja" {
		t.Fatalf("languageCode = %#v", got)
	}
	if got := requestedBody["regionCode"]; got != "JP" {
		t.Fatalf("regionCode = %#v", got)
	}
	if _, ok := requestedBody["locationBias"].(map[string]any); !ok {
		t.Fatalf("locationBias missing from request body: %#v", requestedBody)
	}
	if len(suggestions) != 1 {
		t.Fatalf("suggestions = %+v, want one result", suggestions)
	}
	if suggestions[0].Label != "大阪城公園" || suggestions[0].Subtitle == "" ||
		suggestions[0].Coordinates.Latitude != 34.687315 || suggestions[0].Provider != "google_maps" {
		t.Fatalf("suggestion = %+v", suggestions[0])
	}
}

func TestSearchRanksConcretePlacesBeforeAdministrativeAreas(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/autocomplete":
			_, _ = w.Write([]byte(`{
				"suggestions": [
					{
						"placePrediction": {
							"placeId": "city",
							"structuredFormat": {"mainText": {"text": "大阪市"}, "secondaryText": {"text": "大阪府"}},
							"types": ["locality", "political", "geocode"]
						}
					},
					{
						"placePrediction": {
							"placeId": "hall",
							"structuredFormat": {"mainText": {"text": "大阪城ホール"}, "secondaryText": {"text": "大阪府大阪市中央区大阪城３−１"}},
							"types": ["concert_hall", "point_of_interest", "establishment"]
						}
					},
					{
						"placePrediction": {
							"placeId": "station",
							"structuredFormat": {"mainText": {"text": "大阪駅"}, "secondaryText": {"text": "大阪府大阪市北区梅田３丁目１"}},
							"types": ["train_station", "transit_station", "point_of_interest", "establishment"]
						}
					}
				]
			}`))
		case "/places/station":
			_, _ = w.Write([]byte(`{"id":"station","displayName":{"text":"大阪駅"},"formattedAddress":"大阪府大阪市北区梅田３丁目１","location":{"latitude":34.7024854,"longitude":135.4959506}}`))
		case "/places/hall":
			_, _ = w.Write([]byte(`{"id":"hall","displayName":{"text":"大阪城ホール"},"formattedAddress":"大阪府大阪市中央区大阪城３−１","location":{"latitude":34.689556,"longitude":135.530102}}`))
		case "/places/city":
			_, _ = w.Write([]byte(`{"id":"city","displayName":{"text":"大阪市"},"formattedAddress":"大阪府大阪市","location":{"latitude":34.6952474,"longitude":135.5012079}}`))
		default:
			t.Fatalf("unexpected path = %s", r.URL.Path)
		}
	}))
	defer server.Close()

	suggestions, err := NewService(
		"test-places-key",
		WithEndpoint(server.URL+"/autocomplete"),
		WithDetailsEndpoint(server.URL+"/places/%s?languageCode=%s"),
	).Search(context.Background(), SearchInput{Query: "大阪", Language: "ja", Limit: 3})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if len(suggestions) != 3 {
		t.Fatalf("suggestions = %+v, want three", suggestions)
	}
	if suggestions[0].Label != "大阪駅" {
		t.Fatalf("first suggestion = %+v, want 大阪駅 before administrative areas", suggestions[0])
	}
}

func TestNearbyUsesGooglePlacesNearbySearch(t *testing.T) {
	var requestedBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/nearby" {
			t.Fatalf("unexpected path = %s", r.URL.Path)
		}
		if got := r.Header.Get("X-Goog-Api-Key"); got != "test-places-key" {
			t.Fatalf("api key header = %q", got)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		fieldMask := r.Header.Get("X-Goog-FieldMask")
		for _, field := range []string{"places.id", "places.displayName", "places.location"} {
			if !strings.Contains(fieldMask, field) {
				t.Fatalf("nearby field mask %q does not contain %q", fieldMask, field)
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&requestedBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"places": [
				{
					"id": "ChIJosaka-station",
					"displayName": {"text": "大阪駅"},
					"formattedAddress": "大阪府大阪市北区梅田３丁目１−１",
					"location": {"latitude": 34.7024854, "longitude": 135.4959506},
					"primaryType": "train_station",
					"types": ["train_station", "transit_station", "point_of_interest"]
				}
			]
		}`))
	}))
	defer server.Close()

	suggestions, err := NewService(
		"test-places-key",
		WithNearbyEndpoint(server.URL+"/nearby"),
	).Nearby(context.Background(), NearbyInput{
		Latitude:  34.7024854,
		Longitude: 135.4959506,
		Language:  "ja",
		Limit:     5,
	})
	if err != nil {
		t.Fatalf("Nearby() error = %v", err)
	}
	if got := requestedBody["languageCode"]; got != "ja" {
		t.Fatalf("languageCode = %#v", got)
	}
	if got := requestedBody["rankPreference"]; got != "POPULARITY" {
		t.Fatalf("rankPreference = %#v", got)
	}
	if _, ok := requestedBody["locationRestriction"].(map[string]any); !ok {
		t.Fatalf("locationRestriction missing from request body: %#v", requestedBody)
	}
	if len(suggestions) != 1 {
		t.Fatalf("suggestions = %+v, want one result", suggestions)
	}
	if suggestions[0].Label != "大阪駅" || suggestions[0].Coordinates.Longitude != 135.4959506 ||
		suggestions[0].Provider != "google_maps" {
		t.Fatalf("suggestion = %+v", suggestions[0])
	}
}

func TestSearchFailsClosedWhenUnavailableOrInvalid(t *testing.T) {
	if _, err := NewService("").Search(context.Background(), SearchInput{Query: "大阪"}); err != ErrUnavailable {
		t.Fatalf("empty key error = %v, want ErrUnavailable", err)
	}
	if _, err := NewService(PlaceholderAPIKey).Search(context.Background(), SearchInput{Query: "大阪"}); err != ErrUnavailable {
		t.Fatalf("placeholder key error = %v, want ErrUnavailable", err)
	}
	if _, err := NewService("key").Search(context.Background(), SearchInput{Query: " "}); err != ErrInvalidInput {
		t.Fatalf("empty query error = %v, want ErrInvalidInput", err)
	}
	if _, err := NewService("key").Search(context.Background(), SearchInput{Query: "大"}); err != ErrInvalidInput {
		t.Fatalf("one-rune query error = %v, want ErrInvalidInput", err)
	}
	if _, err := NewService("key").Nearby(context.Background(), NearbyInput{Latitude: 91, Longitude: 135}); err != ErrInvalidInput {
		t.Fatalf("invalid nearby error = %v, want ErrInvalidInput", err)
	}
}

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/places"
)

func TestPlaceSearchHandler(t *testing.T) {
	t.Run("requires authentication", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, placesSearchPath+"?query=大阪城公園", nil)
		res := httptest.NewRecorder()

		placeSearch(nil, nil).ServeHTTP(res, req)

		assertPlacesError(t, res, http.StatusUnauthorized, "missing_or_invalid_access_token")
	})

	t.Run("rejects invalid query params", func(t *testing.T) {
		req, sessions := authenticatedPlacesRequest(t, placesSearchPath+"?query=大阪城公園&limit=0")
		res := httptest.NewRecorder()

		placeSearch(places.NewService("test-places-key"), sessions).ServeHTTP(res, req)

		assertPlacesError(t, res, http.StatusBadRequest, "invalid_places_request")
	})

	t.Run("returns backend-normalized suggestions", func(t *testing.T) {
		var requestedBody map[string]any
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("X-Goog-Api-Key"); got != "test-places-key" {
				t.Fatalf("api key = %q, want test-places-key", got)
			}
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/autocomplete":
				if r.Method != http.MethodPost {
					t.Fatalf("method = %s, want POST", r.Method)
				}
				if err := json.NewDecoder(r.Body).Decode(&requestedBody); err != nil {
					t.Fatalf("decode request body: %v", err)
				}
				_, _ = w.Write([]byte(`{"suggestions":[{"placePrediction":{"placeId":"ChIJosaka","structuredFormat":{"mainText":{"text":"大阪城公園"},"secondaryText":{"text":"大阪府大阪市中央区大阪城"}},"types":["park","point_of_interest","establishment"]}}]}`))
			case "/places/ChIJosaka":
				if r.Method != http.MethodGet {
					t.Fatalf("details method = %s, want GET", r.Method)
				}
				_, _ = w.Write([]byte(`{"id":"ChIJosaka","displayName":{"text":"大阪城公園"},"formattedAddress":"大阪府大阪市中央区大阪城","location":{"latitude":34.687315,"longitude":135.526201}}`))
			default:
				t.Fatalf("unexpected path = %s", r.URL.Path)
			}
		}))
		defer provider.Close()

		req, sessions := authenticatedPlacesRequest(t, placesSearchPath+"?query=%E5%A4%A7%E9%98%AA%E5%9F%8E%E5%85%AC%E5%9C%92&language=ja&latitude=34.6937&longitude=135.5023")
		res := httptest.NewRecorder()
		service := places.NewService(
			"test-places-key",
			places.WithEndpoint(provider.URL+"/autocomplete"),
			places.WithDetailsEndpoint(provider.URL+"/places/%s?languageCode=%s"),
		)

		placeSearch(service, sessions).ServeHTTP(res, req)

		if res.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d; body = %s", res.Code, http.StatusOK, res.Body.String())
		}
		if requestedBody["input"] != "大阪城公園" {
			t.Fatalf("input = %#v", requestedBody["input"])
		}
		var payload struct {
			Data []places.Suggestion `json:"data"`
		}
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatalf("decode response: %v; body = %s", err, res.Body.String())
		}
		if len(payload.Data) != 1 || payload.Data[0].Label != "大阪城公園" || payload.Data[0].Provider != "google_maps" {
			t.Fatalf("payload = %+v", payload)
		}
	})

	t.Run("returns 405 for non-GET", func(t *testing.T) {
		req, sessions := authenticatedPlacesRequest(t, placesSearchPath+"?query=大阪城公園")
		req.Method = http.MethodPost
		res := httptest.NewRecorder()

		placeSearch(places.NewService("test-places-key"), sessions).ServeHTTP(res, req)

		if res.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want %d", res.Code, http.StatusMethodNotAllowed)
		}
		if got := res.Header().Get("Allow"); got != http.MethodGet {
			t.Fatalf("Allow = %q, want GET", got)
		}
	})
}

func TestPlaceNearbyHandler(t *testing.T) {
	t.Run("requires authentication", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, placesNearbyPath+"?latitude=34.7&longitude=135.5", nil)
		res := httptest.NewRecorder()

		placeNearby(nil, nil).ServeHTTP(res, req)

		assertPlacesError(t, res, http.StatusUnauthorized, "missing_or_invalid_access_token")
	})

	t.Run("rejects invalid coordinates", func(t *testing.T) {
		req, sessions := authenticatedPlacesRequest(t, placesNearbyPath+"?latitude=bad&longitude=135.5")
		res := httptest.NewRecorder()

		placeNearby(places.NewService("test-places-key"), sessions).ServeHTTP(res, req)

		assertPlacesError(t, res, http.StatusBadRequest, "invalid_places_request")
	})

	t.Run("returns nearby places", func(t *testing.T) {
		var requestedBody map[string]any
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("X-Goog-Api-Key"); got != "test-places-key" {
				t.Fatalf("api key = %q, want test-places-key", got)
			}
			if r.URL.Path != "/nearby" {
				t.Fatalf("unexpected path = %s", r.URL.Path)
			}
			if err := json.NewDecoder(r.Body).Decode(&requestedBody); err != nil {
				t.Fatalf("decode request body: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"places":[{"id":"ChIJosaka-station","displayName":{"text":"大阪駅"},"formattedAddress":"大阪府大阪市北区梅田３丁目１−１","location":{"latitude":34.7024854,"longitude":135.4959506},"primaryType":"train_station","types":["train_station","transit_station"]}]}`))
		}))
		defer provider.Close()

		req, sessions := authenticatedPlacesRequest(t, placesNearbyPath+"?latitude=34.7024854&longitude=135.4959506&language=ja")
		res := httptest.NewRecorder()
		service := places.NewService(
			"test-places-key",
			places.WithNearbyEndpoint(provider.URL+"/nearby"),
		)

		placeNearby(service, sessions).ServeHTTP(res, req)

		if res.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d; body = %s", res.Code, http.StatusOK, res.Body.String())
		}
		if requestedBody["languageCode"] != "ja" {
			t.Fatalf("languageCode = %#v", requestedBody["languageCode"])
		}
		var payload struct {
			Data []places.Suggestion `json:"data"`
		}
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatalf("decode response: %v; body = %s", err, res.Body.String())
		}
		if len(payload.Data) != 1 || payload.Data[0].Label != "大阪駅" || payload.Data[0].Provider != "google_maps" {
			t.Fatalf("payload = %+v", payload)
		}
	})
}

func authenticatedPlacesRequest(t *testing.T, target string) (*http.Request, *auth.SessionService) {
	t.Helper()
	seed, sessions := newAuthenticatedClassificationRequest(t)
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("Authorization", seed.Header.Get("Authorization"))
	return req, sessions
}

func assertPlacesError(t *testing.T, res *httptest.ResponseRecorder, wantStatus int, wantError string) {
	t.Helper()
	if res.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body = %s", res.Code, wantStatus, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), wantError) {
		t.Fatalf("body = %s, want error %q", res.Body.String(), wantError)
	}
}

package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/places"
)

const (
	placesSearchPath = APIV1Prefix + "/places/search"
	placesNearbyPath = APIV1Prefix + "/places/nearby"
)

func placeSearch(service *places.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "places_unavailable"})
			return
		}
		input, err := placesSearchInput(r)
		if err != nil {
			writePlacesError(w, err)
			return
		}
		suggestions, err := service.Search(r.Context(), input)
		if err != nil {
			writePlacesError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": suggestions})
	}
}

func placeNearby(service *places.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "places_unavailable"})
			return
		}
		input, err := placesNearbyInput(r)
		if err != nil {
			writePlacesError(w, err)
			return
		}
		suggestions, err := service.Nearby(r.Context(), input)
		if err != nil {
			writePlacesError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": suggestions})
	}
}

func placesSearchInput(r *http.Request) (places.SearchInput, error) {
	query := r.URL.Query()
	input := places.SearchInput{
		Query:    strings.TrimSpace(query.Get("query")),
		Language: strings.TrimSpace(query.Get("language")),
	}
	if value := strings.TrimSpace(query.Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return places.SearchInput{}, places.ErrInvalidInput
		}
		if parsed < 1 {
			return places.SearchInput{}, places.ErrInvalidInput
		}
		input.Limit = parsed
	}
	if value := strings.TrimSpace(query.Get("latitude")); value != "" {
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return places.SearchInput{}, places.ErrInvalidInput
		}
		input.Latitude = &parsed
	}
	if value := strings.TrimSpace(query.Get("longitude")); value != "" {
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return places.SearchInput{}, places.ErrInvalidInput
		}
		input.Longitude = &parsed
	}
	return input, nil
}

func placesNearbyInput(r *http.Request) (places.NearbyInput, error) {
	query := r.URL.Query()
	latitude, err := strconv.ParseFloat(strings.TrimSpace(query.Get("latitude")), 64)
	if err != nil {
		return places.NearbyInput{}, places.ErrInvalidInput
	}
	longitude, err := strconv.ParseFloat(strings.TrimSpace(query.Get("longitude")), 64)
	if err != nil {
		return places.NearbyInput{}, places.ErrInvalidInput
	}
	input := places.NearbyInput{
		Latitude:  latitude,
		Longitude: longitude,
		Language:  strings.TrimSpace(query.Get("language")),
	}
	if value := strings.TrimSpace(query.Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return places.NearbyInput{}, places.ErrInvalidInput
		}
		if parsed < 1 {
			return places.NearbyInput{}, places.ErrInvalidInput
		}
		input.Limit = parsed
	}
	return input, nil
}

func writePlacesError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, places.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_places_request"})
	case errors.Is(err, places.ErrUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "places_unavailable"})
	case errors.Is(err, places.ErrProviderFailure):
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "places_search_failed"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "places_failed"})
	}
}

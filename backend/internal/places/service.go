package places

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrUnavailable     = errors.New("places provider is unavailable")
	ErrInvalidInput    = errors.New("invalid places input")
	ErrProviderFailure = errors.New("places provider failed")
)

const (
	PlaceholderAPIKey      = "CHANGE_ME_GOOGLE_PLACES_API_KEY"
	defaultEndpoint        = "https://places.googleapis.com/v1/places:autocomplete"
	defaultDetailsEndpoint = "https://places.googleapis.com/v1/places/%s?languageCode=%s"
	defaultNearbyEndpoint  = "https://places.googleapis.com/v1/places:searchNearby"
	defaultTimeout         = 5 * time.Second
	maxQueryRunes          = 120
	defaultLimit           = 5
	maxLimit               = 10
	defaultNearbyRadiusM   = 1_000.0
)

type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

type Option func(*Service)

type Service struct {
	apiKey          string
	endpoint        string
	detailsEndpoint string
	nearbyEndpoint  string
	client          HTTPClient
}

type Coordinates struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	AccuracyM float64 `json:"accuracy_m"`
}

type Suggestion struct {
	ID          string      `json:"id"`
	PlaceID     string      `json:"place_id"`
	Label       string      `json:"label"`
	Subtitle    string      `json:"subtitle"`
	Provider    string      `json:"provider"`
	Coordinates Coordinates `json:"coordinates"`
}

type SearchInput struct {
	Query     string
	Language  string
	Latitude  *float64
	Longitude *float64
	Limit     int
}

type NearbyInput struct {
	Latitude  float64
	Longitude float64
	Language  string
	Limit     int
	RadiusM   float64
}

type autocompleteSuggestion struct {
	PlacePrediction struct {
		PlaceID string `json:"placeId"`
		Text    struct {
			Text string `json:"text"`
		} `json:"text"`
		StructuredFormat struct {
			MainText struct {
				Text string `json:"text"`
			} `json:"mainText"`
			SecondaryText struct {
				Text string `json:"text"`
			} `json:"secondaryText"`
		} `json:"structuredFormat"`
		Types []string `json:"types"`
	} `json:"placePrediction"`
}

type placePrediction struct {
	PlaceID string
	Text    string
	Main    string
	Sub     string
	Types   []string
	Index   int
}

type placeDetails struct {
	ID          string
	DisplayName struct {
		Text string `json:"text"`
	} `json:"displayName"`
	FormattedAddress string `json:"formattedAddress"`
	Location         struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"location"`
}

type nearbyPlace struct {
	ID          string `json:"id"`
	DisplayName struct {
		Text string `json:"text"`
	} `json:"displayName"`
	FormattedAddress string   `json:"formattedAddress"`
	Types            []string `json:"types"`
	PrimaryType      string   `json:"primaryType"`
	Location         struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"location"`
}

func NewService(apiKey string, options ...Option) *Service {
	service := &Service{
		apiKey:          strings.TrimSpace(apiKey),
		endpoint:        defaultEndpoint,
		detailsEndpoint: defaultDetailsEndpoint,
		nearbyEndpoint:  defaultNearbyEndpoint,
		client:          &http.Client{Timeout: defaultTimeout},
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func WithEndpoint(endpoint string) Option {
	return func(service *Service) {
		service.endpoint = strings.TrimSpace(endpoint)
	}
}

func WithDetailsEndpoint(endpoint string) Option {
	return func(service *Service) {
		service.detailsEndpoint = strings.TrimSpace(endpoint)
	}
}

func WithNearbyEndpoint(endpoint string) Option {
	return func(service *Service) {
		service.nearbyEndpoint = strings.TrimSpace(endpoint)
	}
}

func WithHTTPClient(client HTTPClient) Option {
	return func(service *Service) {
		if client != nil {
			service.client = client
		}
	}
}

func (s *Service) Available() bool {
	return s != nil && s.client != nil && s.endpoint != "" && s.detailsEndpoint != "" && s.nearbyEndpoint != "" &&
		s.apiKey != "" && s.apiKey != PlaceholderAPIKey
}

func (s *Service) Search(ctx context.Context, input SearchInput) ([]Suggestion, error) {
	if !s.Available() {
		return nil, ErrUnavailable
	}
	input, err := normalizeSearchInput(input)
	if err != nil {
		return nil, err
	}

	body := map[string]any{
		"input":                            input.Query,
		"languageCode":                     input.Language,
		"regionCode":                       "JP",
		"includedRegionCodes":              []string{"jp"},
		"includePureServiceAreaBusinesses": false,
	}
	if input.Latitude != nil {
		body["locationBias"] = map[string]any{
			"circle": map[string]any{
				"center": map[string]float64{
					"latitude":  *input.Latitude,
					"longitude": *input.Longitude,
				},
				"radius": 50_000.0,
			},
		}
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, ErrProviderFailure
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Goog-Api-Key", s.apiKey)
	request.Header.Set("X-Goog-FieldMask", "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types")

	response, err := s.client.Do(request)
	if err != nil {
		return nil, ErrProviderFailure
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: status %d", ErrProviderFailure, response.StatusCode)
	}

	var decoded struct {
		Suggestions []autocompleteSuggestion `json:"suggestions"`
	}
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return nil, ErrProviderFailure
	}

	predictions := rankedPredictions(decoded.Suggestions, input.Query)
	suggestions := make([]Suggestion, 0, min(input.Limit, len(predictions)))
	seen := make(map[string]struct{}, len(predictions))
	for _, prediction := range predictions {
		if len(suggestions) >= input.Limit {
			break
		}
		if _, duplicate := seen[prediction.PlaceID]; duplicate {
			continue
		}
		seen[prediction.PlaceID] = struct{}{}
		details, err := s.details(ctx, prediction.PlaceID, input.Language)
		if err != nil {
			return nil, err
		}
		label := strings.TrimSpace(details.DisplayName.Text)
		if label == "" {
			label = strings.TrimSpace(prediction.Main)
		}
		if label == "" {
			label = strings.TrimSpace(prediction.Text)
		}
		if label == "" || !finiteCoordinate(details.Location.Latitude, details.Location.Longitude) {
			continue
		}
		id := strings.TrimSpace(details.ID)
		if id == "" {
			id = prediction.PlaceID
		}
		subtitle := strings.TrimSpace(details.FormattedAddress)
		if subtitle == "" {
			subtitle = strings.TrimSpace(prediction.Sub)
		}
		suggestions = append(suggestions, Suggestion{
			ID:       id,
			PlaceID:  prediction.PlaceID,
			Label:    label,
			Subtitle: subtitle,
			Provider: "google_maps",
			Coordinates: Coordinates{
				Latitude:  details.Location.Latitude,
				Longitude: details.Location.Longitude,
				AccuracyM: 0,
			},
		})
	}
	return suggestions, nil
}

func (s *Service) Nearby(ctx context.Context, input NearbyInput) ([]Suggestion, error) {
	if !s.Available() {
		return nil, ErrUnavailable
	}
	input, err := normalizeNearbyInput(input)
	if err != nil {
		return nil, err
	}

	body := map[string]any{
		"languageCode":   input.Language,
		"regionCode":     "JP",
		"maxResultCount": input.Limit,
		"rankPreference": "POPULARITY",
		"includedTypes":  nearbyIncludedTypes(),
		"locationRestriction": map[string]any{
			"circle": map[string]any{
				"center": map[string]float64{
					"latitude":  input.Latitude,
					"longitude": input.Longitude,
				},
				"radius": input.RadiusM,
			},
		},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.nearbyEndpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, ErrProviderFailure
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Goog-Api-Key", s.apiKey)
	request.Header.Set("X-Goog-FieldMask", "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types")

	response, err := s.client.Do(request)
	if err != nil {
		return nil, ErrProviderFailure
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: nearby status %d", ErrProviderFailure, response.StatusCode)
	}

	var decoded struct {
		Places []nearbyPlace `json:"places"`
	}
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return nil, ErrProviderFailure
	}
	suggestions := make([]Suggestion, 0, min(input.Limit, len(decoded.Places)))
	seen := make(map[string]struct{}, len(decoded.Places))
	for _, place := range decoded.Places {
		if len(suggestions) >= input.Limit {
			break
		}
		id := strings.TrimSpace(place.ID)
		label := strings.TrimSpace(place.DisplayName.Text)
		if id == "" || label == "" || !finiteCoordinate(place.Location.Latitude, place.Location.Longitude) {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		suggestions = append(suggestions, Suggestion{
			ID:       id,
			PlaceID:  id,
			Label:    label,
			Subtitle: strings.TrimSpace(place.FormattedAddress),
			Provider: "google_maps",
			Coordinates: Coordinates{
				Latitude:  place.Location.Latitude,
				Longitude: place.Location.Longitude,
				AccuracyM: 0,
			},
		})
	}
	return suggestions, nil
}

func (s *Service) details(ctx context.Context, placeID, language string) (placeDetails, error) {
	requestURL := fmt.Sprintf(s.detailsEndpoint, url.PathEscape(placeID), url.QueryEscape(language))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return placeDetails{}, ErrProviderFailure
	}
	request.Header.Set("X-Goog-Api-Key", s.apiKey)
	request.Header.Set("X-Goog-FieldMask", "id,displayName,formattedAddress,location")
	response, err := s.client.Do(request)
	if err != nil {
		return placeDetails{}, ErrProviderFailure
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return placeDetails{}, fmt.Errorf("%w: details status %d", ErrProviderFailure, response.StatusCode)
	}
	var details placeDetails
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		return placeDetails{}, ErrProviderFailure
	}
	return details, nil
}

func rankedPredictions(raw []autocompleteSuggestion, query string) []placePrediction {
	predictions := make([]placePrediction, 0, len(raw))
	for index, item := range raw {
		rawPrediction := item.PlacePrediction
		placeID := strings.TrimSpace(rawPrediction.PlaceID)
		if placeID == "" {
			continue
		}
		predictions = append(predictions, placePrediction{
			PlaceID: placeID,
			Text:    strings.TrimSpace(rawPrediction.Text.Text),
			Main:    strings.TrimSpace(rawPrediction.StructuredFormat.MainText.Text),
			Sub:     strings.TrimSpace(rawPrediction.StructuredFormat.SecondaryText.Text),
			Types:   normalizedTypes(rawPrediction.Types),
			Index:   index,
		})
	}
	sort.SliceStable(predictions, func(i, j int) bool {
		left := predictionScore(predictions[i], query)
		right := predictionScore(predictions[j], query)
		if left != right {
			return left > right
		}
		return predictions[i].Index < predictions[j].Index
	})
	return predictions
}

func normalizedTypes(values []string) []string {
	types := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value != "" {
			types = append(types, value)
		}
	}
	return types
}

func predictionScore(prediction placePrediction, query string) int {
	score := 0
	main := strings.ToLower(strings.TrimSpace(prediction.Main))
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	if main != "" && normalizedQuery != "" {
		if main == normalizedQuery {
			score += 40
		} else if strings.HasPrefix(main, normalizedQuery) {
			score += 20
		}
	}
	if hasType(prediction.Types, "train_station") || hasType(prediction.Types, "transit_station") {
		score += 35
	}
	if hasType(prediction.Types, "tourist_attraction") || hasType(prediction.Types, "park") || hasType(prediction.Types, "castle") {
		score += 30
	}
	if hasType(prediction.Types, "point_of_interest") || hasType(prediction.Types, "establishment") {
		score += 25
	}
	if hasType(prediction.Types, "geocode") || hasType(prediction.Types, "political") {
		score -= 25
	}
	return score
}

func hasType(types []string, target string) bool {
	for _, value := range types {
		if value == target {
			return true
		}
	}
	return false
}

func nearbyIncludedTypes() []string {
	return []string{
		"tourist_attraction",
		"train_station",
		"transit_station",
		"restaurant",
		"cafe",
		"park",
		"museum",
		"shopping_mall",
		"store",
	}
}

func normalizeSearchInput(input SearchInput) (SearchInput, error) {
	input.Query = strings.TrimSpace(input.Query)
	queryLength := utf8.RuneCountInString(input.Query)
	if queryLength < 2 || !utf8.ValidString(input.Query) || queryLength > maxQueryRunes {
		return SearchInput{}, ErrInvalidInput
	}
	if input.Limit == 0 {
		input.Limit = defaultLimit
	}
	if input.Limit < 1 || input.Limit > maxLimit {
		return SearchInput{}, ErrInvalidInput
	}
	input.Language = strings.ToLower(strings.TrimSpace(input.Language))
	if input.Language != "ja" {
		input.Language = "en"
	}
	if (input.Latitude == nil) != (input.Longitude == nil) {
		return SearchInput{}, ErrInvalidInput
	}
	if input.Latitude != nil && !finiteCoordinate(*input.Latitude, *input.Longitude) {
		return SearchInput{}, ErrInvalidInput
	}
	return input, nil
}

func normalizeNearbyInput(input NearbyInput) (NearbyInput, error) {
	if !finiteCoordinate(input.Latitude, input.Longitude) {
		return NearbyInput{}, ErrInvalidInput
	}
	if input.Limit == 0 {
		input.Limit = defaultLimit
	}
	if input.Limit < 1 || input.Limit > maxLimit {
		return NearbyInput{}, ErrInvalidInput
	}
	input.Language = strings.ToLower(strings.TrimSpace(input.Language))
	if input.Language != "ja" {
		input.Language = "en"
	}
	if input.RadiusM == 0 {
		input.RadiusM = defaultNearbyRadiusM
	}
	if input.RadiusM < 1 || input.RadiusM > 50_000 {
		return NearbyInput{}, ErrInvalidInput
	}
	return input, nil
}

func finiteCoordinate(latitude, longitude float64) bool {
	return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

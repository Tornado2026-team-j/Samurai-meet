package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/meeting"
)

const recruitmentPath = APIV1Prefix + "/recruitments"

func recruitmentCollection(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_unavailable"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			params, err := recruitmentSearchParams(r)
			if err != nil {
				writeMatchingError(w, err)
				return
			}
			items, err := service.SearchRecruitments(r.Context(), claims.Subject, params, time.Now())
			if err != nil {
				writeMatchingError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": items})
		case http.MethodPost:
			var input matching.RecruitmentInput
			if err := decodeJSONRequest(w, r, &input, 64*1024); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_request"})
				return
			}
			item, err := service.CreateRecruitment(r.Context(), claims.Subject, input, time.Now())
			if err != nil {
				writeMatchingError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"data": item})
		default:
			w.Header().Set("Allow", "GET, POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func ownedRecruitmentCollection(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_unavailable"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		items, err := service.ListOwnedRecruitments(r.Context(), claims.Subject, time.Now())
		if err != nil {
			writeMatchingError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": items})
	}
}

func recruitmentItem(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_unavailable"})
			return
		}
		parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, recruitmentPath+"/"), "/"), "/")
		if len(parts) == 0 || parts[0] == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "recruitment_not_found"})
			return
		}
		recruitmentID, err := url.PathUnescape(parts[0])
		if err != nil || recruitmentID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_id"})
			return
		}
		if len(parts) == 2 && parts[1] == "interest" {
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", "POST")
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			match, interestErr := service.SendInterest(r.Context(), claims.Subject, recruitmentID, time.Now())
			if interestErr != nil {
				writeMatchingErrorWithData(w, interestErr, match)
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"data": match})
			return
		}
		if len(parts) != 1 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "recruitment_not_found"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			item, getErr := service.GetRecruitment(r.Context(), claims.Subject, recruitmentID, time.Now())
			if getErr != nil {
				writeMatchingError(w, getErr)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": item})
		case http.MethodPatch:
			var patch matching.RecruitmentPatch
			if err := decodeJSONRequest(w, r, &patch, 64*1024); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_request"})
				return
			}
			item, updateErr := service.UpdateRecruitment(r.Context(), claims.Subject, recruitmentID, patch, time.Now())
			if updateErr != nil {
				writeMatchingError(w, updateErr)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": item})
		case http.MethodDelete:
			if closeErr := service.CloseRecruitment(r.Context(), claims.Subject, recruitmentID, time.Now()); closeErr != nil {
				writeMatchingError(w, closeErr)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.Header().Set("Allow", "GET, PATCH, DELETE")
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func matchCollection(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_unavailable"})
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		params, err := matchListParams(r)
		if err != nil {
			writeMatchingError(w, err)
			return
		}
		items, err := service.ListMatches(r.Context(), claims.Subject, params, time.Now())
		if err != nil {
			writeMatchingError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": items})
	}
}

func matchAction(service *matching.Service, sessions *auth.SessionService, meetingServices ...*meeting.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, APIV1Prefix+"/matches/"), "/"), "/")
		if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodGet {
			if service == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_unavailable"})
				return
			}
			matchID, err := url.PathUnescape(parts[0])
			if err != nil || matchID == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_match_id"})
				return
			}
			result, getErr := service.GetMatch(r.Context(), claims.Subject, matchID)
			if getErr != nil {
				writeMatchingError(w, getErr)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
			return
		}
		if len(parts) != 2 || parts[0] == "" || r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		matchID, err := url.PathUnescape(parts[0])
		if err != nil || matchID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_match_id"})
			return
		}
		var meetingService *meeting.Service
		if len(meetingServices) > 0 {
			meetingService = meetingServices[0]
		}
		if parts[1] == "meeting" {
			if meetingService == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "meeting_unavailable"})
				return
			}
			var input struct {
				ScheduledAt string `json:"scheduled_at"`
			}
			if err := decodeJSONRequest(w, r, &input, 8*1024); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_meeting_request"})
				return
			}
			result, createErr := meetingService.Create(r.Context(), claims.Subject, matchID, input.ScheduledAt, time.Now())
			if createErr != nil {
				writeMeetingError(w, createErr)
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"data": result})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_unavailable"})
			return
		}
		var result matching.Match
		switch parts[1] {
		case "accept":
			result, err = service.AcceptMatch(r.Context(), claims.Subject, matchID, time.Now())
		case "complete":
			result, err = service.CompleteMatch(r.Context(), claims.Subject, matchID, time.Now())
		case "reject":
			result, err = service.RejectMatch(r.Context(), claims.Subject, matchID, time.Now())
		case "withdraw":
			result, err = service.WithdrawInterest(r.Context(), claims.Subject, matchID, time.Now())
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found"})
			return
		}
		if err != nil {
			writeMatchingErrorWithData(w, err, result)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func updateLocation(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_unavailable"})
			return
		}
		var raw struct {
			Latitude   *float64 `json:"latitude"`
			Longitude  *float64 `json:"longitude"`
			AccuracyM  *float64 `json:"accuracy_m"`
			CapturedAt string   `json:"captured_at"`
		}
		if err := decodeJSONRequest(w, r, &raw, 16*1024); err != nil || raw.Latitude == nil || raw.Longitude == nil || raw.AccuracyM == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_location_request"})
			return
		}
		input := matching.LocationInput{Latitude: *raw.Latitude, Longitude: *raw.Longitude, AccuracyM: *raw.AccuracyM, CapturedAt: raw.CapturedAt}
		if err := service.UpdateLocation(r.Context(), claims.Subject, input, time.Now()); err != nil {
			writeMatchingError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func recruitmentSearchParams(r *http.Request) (matching.SearchParams, error) {
	query := r.URL.Query()
	params := matching.SearchParams{
		Keywords:      append([]string(nil), query["keyword"]...),
		Category:      strings.TrimSpace(query.Get("category")),
		AvailableDate: strings.TrimSpace(query.Get("available_date")),
		AvailableFrom: strings.TrimSpace(query.Get("available_from")),
		AvailableTo:   strings.TrimSpace(query.Get("available_to")),
		StartTime:     strings.TrimSpace(query.Get("start_time")),
		EndTime:       strings.TrimSpace(query.Get("end_time")),
	}
	if value := strings.TrimSpace(query.Get("radius_km")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return matching.SearchParams{}, matching.ErrInvalidInput
		}
		params.RadiusKM = parsed
	}
	if value := strings.TrimSpace(query.Get("verified_only")); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return matching.SearchParams{}, matching.ErrInvalidInput
		}
		params.VerifiedOnly = parsed
	}
	if value := strings.TrimSpace(query.Get("latitude")); value != "" {
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return matching.SearchParams{}, matching.ErrInvalidInput
		}
		params.Latitude = &parsed
	}
	if value := strings.TrimSpace(query.Get("longitude")); value != "" {
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return matching.SearchParams{}, matching.ErrInvalidInput
		}
		params.Longitude = &parsed
	}
	if value := strings.TrimSpace(query.Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return matching.SearchParams{}, matching.ErrInvalidInput
		}
		params.Limit = parsed
	}
	return params, nil
}

func matchListParams(r *http.Request) (matching.MatchListParams, error) {
	query := r.URL.Query()
	params := matching.MatchListParams{
		Role:   strings.TrimSpace(query.Get("role")),
		Status: strings.TrimSpace(query.Get("status")),
	}
	if value := strings.TrimSpace(query.Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return matching.MatchListParams{}, matching.ErrInvalidInput
		}
		params.Limit = parsed
	}
	return params, nil
}

func decodeJSONRequest(w http.ResponseWriter, r *http.Request, destination any, maxBytes int64) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err == nil {
		return errors.New("multiple JSON values")
	} else if !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func writeMatchingError(w http.ResponseWriter, err error) {
	writeMatchingErrorWithData(w, err, nil)
}

func writeMatchingErrorWithData(w http.ResponseWriter, err error, data any) {
	status := http.StatusInternalServerError
	code := "matching_failed"
	switch {
	case errors.Is(err, matching.ErrInvalidInput):
		status, code = http.StatusBadRequest, "invalid_matching_request"
	case errors.Is(err, matching.ErrProfileIncomplete):
		status, code = http.StatusConflict, "profile_incomplete"
	case errors.Is(err, matching.ErrRecruitmentNotFound), errors.Is(err, matching.ErrMatchNotFound), errors.Is(err, matching.ErrBlocked):
		status, code = http.StatusNotFound, "matching_target_not_found"
	case errors.Is(err, matching.ErrForbidden):
		status, code = http.StatusForbidden, "matching_forbidden"
	case errors.Is(err, matching.ErrDuplicateInterest):
		status, code = http.StatusConflict, "interest_already_sent"
	case errors.Is(err, matching.ErrRecruitmentExpired):
		status, code = http.StatusConflict, "recruitment_expired"
	case errors.Is(err, matching.ErrInvalidState):
		status, code = http.StatusConflict, "invalid_matching_state"
	}
	if data == nil {
		writeJSON(w, status, map[string]string{"error": code})
		return
	}
	writeJSON(w, status, map[string]any{"error": code, "data": data})
}

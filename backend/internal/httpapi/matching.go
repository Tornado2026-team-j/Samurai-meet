package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
)

const (
	recruitmentsPrefix = APIV1Prefix + "/recruitments"
	matchesPrefix      = APIV1Prefix + "/matches"
	blocksPrefix       = APIV1Prefix + "/blocks"
	meBlocksPath       = APIV1Prefix + "/me/blocks"
)

type recruitmentCardInput struct {
	Activity      string `json:"activity"`
	LocationLabel string `json:"location_label"`
	AvailableDate string `json:"available_date"`
	StartTime     string `json:"start_time"`
	DurationHours int    `json:"duration_hours"`
	DistanceKm    int    `json:"distance_km"`
}

// recruitmentCards handles POST /recruitments (create) and GET /recruitments
// (list the caller's own cards). Public keyword/radius search is out of
// scope for this phase.
func recruitmentCards(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		switch r.Method {
		case http.MethodPost:
			var input recruitmentCardInput
			if r.Body == nil || r.ContentLength > 4096 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_card"})
				return
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			if err := decoder.Decode(&input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_card"})
				return
			}
			card, err := service.CreateCard(r.Context(), claims.Subject, input.Activity, input.LocationLabel, input.AvailableDate, input.StartTime, input.DurationHours, input.DistanceKm, time.Now())
			if errors.Is(err, matching.ErrInvalidCard) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_card"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "recruitment_card_create_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": card})
		case http.MethodGet:
			cards, err := service.ListOwnedCards(r.Context(), claims.Subject)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "recruitment_card_list_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": cards})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// recruitmentCardItem handles GET /recruitments/{id} and
// POST /recruitments/{id}/interest.
func recruitmentCardItem(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, recruitmentsPrefix+"/")
		cardID, action, hasAction := strings.Cut(rest, "/")
		if cardID == "" || (hasAction && action != "interest") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "recruitment_card_not_found"})
			return
		}

		if hasAction {
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			match, err := service.SendInterest(r.Context(), cardID, claims.Subject, time.Now())
			writeInterestResult(w, match, err)
			return
		}

		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		card, err := service.GetCard(r.Context(), cardID)
		if errors.Is(err, matching.ErrCardNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "recruitment_card_not_found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "recruitment_card_get_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": card})
	}
}

func writeInterestResult(w http.ResponseWriter, match matching.Match, err error) {
	switch {
	case errors.Is(err, matching.ErrCardNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "recruitment_card_not_found"})
	case errors.Is(err, matching.ErrCardNotOpen):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "recruitment_card_not_open"})
	case errors.Is(err, matching.ErrOwnCard):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot_interest_own_card"})
	case errors.Is(err, matching.ErrBlocked):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "blocked"})
	case errors.Is(err, matching.ErrDuplicateInterest):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "interest_already_sent"})
	case errors.Is(err, matching.ErrInvalidCard):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recruitment_card"})
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "interest_send_failed"})
	default:
		writeJSON(w, http.StatusOK, map[string]any{"data": match})
	}
}

// matchAccept handles POST /matches/{id}/accept. Only the recruitment
// card's owner may accept a pending match.
func matchAccept(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, matchesPrefix+"/")
		matchID, action, hasAction := strings.Cut(rest, "/")
		if matchID == "" || !hasAction || action != "accept" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found"})
			return
		}
		match, err := service.AcceptMatch(r.Context(), matchID, claims.Subject, time.Now())
		switch {
		case errors.Is(err, matching.ErrMatchNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found"})
		case errors.Is(err, matching.ErrNotCardOwner):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "not_card_owner"})
		case errors.Is(err, matching.ErrMatchNotPending):
			writeJSON(w, http.StatusConflict, map[string]string{"error": "match_not_pending"})
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "match_accept_failed"})
		default:
			writeJSON(w, http.StatusOK, map[string]any{"data": match})
		}
	}
}

type blockInput struct {
	UserID string `json:"user_id"`
}

// blocks handles POST /blocks (create) and is also mounted at GET
// /me/blocks (list) via the router.
func blocks(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		switch r.Method {
		case http.MethodPost:
			var input blockInput
			if r.Body == nil || r.ContentLength > 1024 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_block_request"})
				return
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
			if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.UserID) == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_block_request"})
				return
			}
			if err := service.CreateBlock(r.Context(), claims.Subject, input.UserID, time.Now()); err != nil {
				if errors.Is(err, matching.ErrInvalidBlock) {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_block_request"})
					return
				}
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "block_create_failed"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodGet:
			blocked, err := service.ListBlocks(r.Context(), claims.Subject)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "block_list_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": blocked})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// blockItem handles DELETE /blocks/{user_id}.
func blockItem(service *matching.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		userID := strings.TrimPrefix(r.URL.Path, blocksPrefix+"/")
		if userID == "" || strings.Contains(userID, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_block_target"})
			return
		}
		if err := service.RemoveBlock(r.Context(), claims.Subject, userID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "block_remove_failed"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

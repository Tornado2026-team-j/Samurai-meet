package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/meeting"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/memorymonster"
)

const memoryMonstersPath = APIV1Prefix + "/memory-monsters"

func memoryMonsterCollection(service *memorymonster.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "memory_monster_unavailable"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
			items, err := service.List(r.Context(), claims.Subject, limit)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "memory_monster_list_failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": items})
		default:
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func memoryMonsterItem(service *memorymonster.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "memory_monster_unavailable"})
			return
		}
		monsterID, action, ok := memoryMonsterPathParts(r.URL.Path)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory_monster_not_found"})
			return
		}
		if action != "image" || r.Method != http.MethodGet {
			if action == "image" {
				w.Header().Set("Allow", http.MethodGet)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory_monster_not_found"})
			return
		}
		image, err := service.GetImage(r.Context(), claims.Subject, monsterID)
		if errors.Is(err, memorymonster.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory_monster_not_found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "memory_monster_image_failed"})
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Content-Type", image.ContentType)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(image.Bytes)
	}
}

func matchMemoryMonsters(service *memorymonster.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "memory_monster_unavailable"})
			return
		}
		matchID, ok := matchMemoryMonsterPath(r.URL.Path)
		if !ok || r.Method != http.MethodPost {
			if ok {
				w.Header().Set("Allow", http.MethodPost)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, memorymonster.MaxGeneratePhotoBytes+1024*1024)
		if err := r.ParseMultipartForm(memorymonster.MaxGeneratePhotoBytes + 1024*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_memory_monster_request"})
			return
		}
		file, header, err := r.FormFile("photo")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_memory_monster_request"})
			return
		}
		defer file.Close()
		photo, err := io.ReadAll(io.LimitReader(file, memorymonster.MaxGeneratePhotoBytes+1))
		if err != nil || len(photo) > memorymonster.MaxGeneratePhotoBytes {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "memory_monster_photo_too_large"})
			return
		}
		contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = http.DetectContentType(photo)
		}
		monster, err := service.Create(r.Context(), claims.Subject, memorymonster.CreateInput{
			MatchID:          matchID,
			MeetingID:        strings.TrimSpace(r.FormValue("meeting_id")),
			SourcePhotoID:    strings.TrimSpace(r.FormValue("source_photo_id")),
			Photo:            photo,
			PhotoContentType: contentType,
			MemorableObject:  r.FormValue("memorable_object"),
			MemoryText:       r.FormValue("memory_text"),
		}, time.Now())
		if err != nil {
			writeMemoryMonsterError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"data": monster})
	}
}

func matchActionOrMemoryMonster(matchService *matching.Service, monsterService *memorymonster.Service, sessions *auth.SessionService, meetingService *meeting.Service) http.HandlerFunc {
	matchHandler := matchAction(matchService, sessions, meetingService)
	monsterHandler := matchMemoryMonsters(monsterService, sessions)
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := matchMemoryMonsterPath(r.URL.Path); ok {
			monsterHandler(w, r)
			return
		}
		matchHandler(w, r)
	}
}

func memoryMonsterPathParts(path string) (string, string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, memoryMonstersPath+"/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func matchMemoryMonsterPath(path string) (string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, APIV1Prefix+"/matches/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "memory-monsters" {
		return "", false
	}
	return parts[0], true
}

func writeMemoryMonsterError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, memorymonster.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_memory_monster_request"})
	case errors.Is(err, memorymonster.ErrForbidden), errors.Is(err, memorymonster.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found"})
	case errors.Is(err, memorymonster.ErrInvalidState):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "memory_monster_meeting_not_completed"})
	case errors.Is(err, memorymonster.ErrPhotoNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "source_photo_not_found"})
	case errors.Is(err, memorymonster.ErrGenerationUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "memory_monster_generation_unavailable"})
	case errors.Is(err, memorymonster.ErrGenerationRateLimited):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "memory_monster_generation_rate_limited"})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "memory_monster_generation_failed"})
	}
}

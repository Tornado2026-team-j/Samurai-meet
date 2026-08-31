package integration

import (
	"context"
	"database/sql"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
)

func TestLogoutOtherSessionsRequiresRecentPasskey(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Now().UTC()
	userID := randomID(t)
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users (id,google_subject_id,status,created_at,updated_at) VALUES ($1,$2,'active',$3,$3)`,
		userID, "session-management-authz-"+userID, now.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(randomBytes(t, 32)), "integration-issuer", "integration-audience")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionService(database, signer)
	current, err := sessions.CreateSession(ctx, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	other, err := sessions.CreateSession(ctx, userID, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/sessions/logout-other", nil)
	req.Header.Set("Authorization", "Bearer "+current.AccessToken)
	res := httptest.NewRecorder()
	httpapi.NewRouterWithOptions(httpapi.RouterOptions{Sessions: sessions}).ServeHTTP(res, req)
	if res.Code != http.StatusForbidden || !strings.Contains(res.Body.String(), "recent_passkey_authentication_required") {
		t.Fatalf("without recent Passkey status = %d body = %s", res.Code, res.Body.String())
	}
	assertSessionState(t, database, current.SessionID, "active", false)
	assertSessionState(t, database, other.SessionID, "active", false)
}

func TestRevokeOtherSessionsPreservesCurrentSessionAndRefreshToken(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.August, 30, 13, 0, 0, 0, time.UTC)
	userID := randomID(t)
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users (id,google_subject_id,status,created_at,updated_at) VALUES ($1,$2,'active',$3,$3)`,
		userID, "session-management-"+userID, now.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(randomBytes(t, 32)), "integration-issuer", "integration-audience")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionService(database, signer)
	current, err := sessions.CreateSession(ctx, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	other, err := sessions.CreateSession(ctx, userID, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	third, err := sessions.CreateSession(ctx, userID, now.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}

	if err := sessions.RevokeOther(ctx, userID, current.SessionID, "logout_other_sessions", now.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := sessions.RevokeOther(ctx, userID, current.SessionID, "logout_other_sessions", now.Add(4*time.Second)); err != nil {
		t.Fatalf("repeat revoke other sessions error = %v", err)
	}

	assertSessionState(t, database, current.SessionID, "active", false)
	assertSessionState(t, database, other.SessionID, "revoked", true)
	assertSessionState(t, database, third.SessionID, "revoked", true)
}

func assertSessionState(t *testing.T, database *sql.DB, sessionID, wantStatus string, wantRefreshRevoked bool) {
	t.Helper()
	var status string
	if err := database.QueryRow(`SELECT status FROM sessions WHERE id=$1`, sessionID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != wantStatus {
		t.Fatalf("session %s status = %q, want %q", sessionID, status, wantStatus)
	}
	var refreshRevoked bool
	if err := database.QueryRow(`SELECT EXISTS(SELECT 1 FROM refresh_tokens WHERE session_id=$1 AND revoked_at IS NOT NULL)`, sessionID).Scan(&refreshRevoked); err != nil {
		t.Fatal(err)
	}
	if refreshRevoked != wantRefreshRevoked {
		t.Fatalf("session %s refresh revoked = %t, want %t", sessionID, refreshRevoked, wantRefreshRevoked)
	}
}

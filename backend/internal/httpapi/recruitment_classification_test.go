package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/classification"
)

func TestClassifyRecruitmentHandler(t *testing.T) {
	t.Run("GET returns 405 and Allow POST", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, APIV1Prefix+"/recruitments/classify", nil)
		res := httptest.NewRecorder()

		classifyRecruitment(nil, nil).ServeHTTP(res, req)

		if res.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want %d", res.Code, http.StatusMethodNotAllowed)
		}
		if got := res.Header().Get("Allow"); got != http.MethodPost {
			t.Fatalf("Allow = %q, want %q", got, http.MethodPost)
		}
	})

	t.Run("POST without access token returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/recruitments/classify", strings.NewReader(`{"description":"ramen"}`))
		res := httptest.NewRecorder()

		classifyRecruitment(nil, nil).ServeHTTP(res, req)

		assertClassificationError(t, res, http.StatusUnauthorized, "missing_or_invalid_access_token")
	})

	t.Run("authenticated POST returns 503 when classifier is unavailable", func(t *testing.T) {
		req, sessions := newAuthenticatedClassificationRequest(t)
		res := httptest.NewRecorder()

		classifyRecruitment(nil, sessions).ServeHTTP(res, req)

		assertClassificationError(t, res, http.StatusServiceUnavailable, "recruitment_classification_unavailable")
	})

	t.Run("authenticated POST returns category and generated keywords", func(t *testing.T) {
		gemini := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.URL.Query().Get("key") != "test-key" {
				t.Fatalf("Gemini request = %s %s", r.Method, r.URL.String())
			}
			_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"category\":\"Food\",\"keywords\":[\"ramen\",\"大阪\"]}"}]}}]}`))
		}))
		defer gemini.Close()

		service := classification.NewGeminiWithClient("test-key", classification.DefaultModel, gemini.URL, gemini.Client())
		req, sessions := newAuthenticatedClassificationRequest(t)
		res := httptest.NewRecorder()

		classifyRecruitment(service, sessions).ServeHTTP(res, req)

		if res.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d; body = %s", res.Code, http.StatusOK, res.Body.String())
		}
		var payload struct {
			Data struct {
				Category string   `json:"category"`
				Keywords []string `json:"keywords"`
			} `json:"data"`
		}
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatalf("decode classification response: %v; body = %s", err, res.Body.String())
		}
		if payload.Data.Category != "Food" {
			t.Fatalf("category = %q, want Food", payload.Data.Category)
		}
		if len(payload.Data.Keywords) != 2 || payload.Data.Keywords[0] != "ramen" || payload.Data.Keywords[1] != "大阪" {
			t.Fatalf("keywords = %#v, want [ramen 大阪]", payload.Data.Keywords)
		}
	})

	for _, test := range []struct {
		name       string
		status     int
		wantStatus int
		wantError  string
		wantRetry  string
	}{
		{name: "provider rate limit", status: http.StatusTooManyRequests, wantStatus: http.StatusTooManyRequests, wantError: "recruitment_classification_rate_limited", wantRetry: "5"},
		{name: "provider credential rejection", status: http.StatusUnauthorized, wantStatus: http.StatusServiceUnavailable, wantError: "recruitment_classification_unavailable"},
		{name: "other provider failure", status: http.StatusBadGateway, wantStatus: http.StatusBadGateway, wantError: "recruitment_classification_failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			gemini := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(`{"error":"provider detail must stay server-side"}`))
			}))
			defer gemini.Close()

			service := classification.NewGeminiWithClient("test-key", classification.DefaultModel, gemini.URL, gemini.Client())
			req, sessions := newAuthenticatedClassificationRequest(t)
			res := httptest.NewRecorder()

			classifyRecruitment(service, sessions).ServeHTTP(res, req)

			assertClassificationError(t, res, test.wantStatus, test.wantError)
			if got := res.Header().Get("Retry-After"); got != test.wantRetry {
				t.Fatalf("Retry-After = %q, want %q", got, test.wantRetry)
			}
			if strings.Contains(res.Body.String(), "test-key") || strings.Contains(res.Body.String(), "provider detail") {
				t.Fatalf("provider details leaked in response: %s", res.Body.String())
			}
		})
	}
}

func assertClassificationError(t *testing.T, res *httptest.ResponseRecorder, wantStatus int, wantError string) {
	t.Helper()
	if res.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body = %s", res.Code, wantStatus, res.Body.String())
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode error response: %v; body = %s", err, res.Body.String())
	}
	if payload.Error != wantError {
		t.Fatalf("error = %q, want %q", payload.Error, wantError)
	}
}

func newAuthenticatedClassificationRequest(t *testing.T) (*http.Request, *auth.SessionService) {
	t.Helper()
	now := time.Now().UTC()
	signer, err := auth.NewSigner(
		base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32)),
		"classification-test-issuer",
		"classification-test-audience",
	)
	if err != nil {
		t.Fatalf("create signer: %v", err)
	}
	token, _, err := signer.Issue("user-1", "session-1", "token-1", now)
	if err != nil {
		t.Fatalf("issue access token: %v", err)
	}

	db := sql.OpenDB(classificationTestConnector{
		expiresAt:  now.Add(time.Hour).Format(time.RFC3339Nano),
		lastSeenAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
	})
	t.Cleanup(func() { _ = db.Close() })

	req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/recruitments/classify", strings.NewReader(`{"description":"ramen"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	return req, auth.NewSessionService(db, signer)
}

type classificationTestConnector struct {
	expiresAt  string
	lastSeenAt string
}

func (c classificationTestConnector) Connect(context.Context) (driver.Conn, error) {
	return classificationTestConn{expiresAt: c.expiresAt, lastSeenAt: c.lastSeenAt}, nil
}

func (classificationTestConnector) Driver() driver.Driver { return classificationTestDriver{} }

type classificationTestDriver struct{}

func (classificationTestDriver) Open(string) (driver.Conn, error) { return nil, driver.ErrSkip }

type classificationTestConn struct {
	expiresAt  string
	lastSeenAt string
}

func (classificationTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (classificationTestConn) Close() error                        { return nil }
func (classificationTestConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (c classificationTestConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &classificationTestRows{
		expiresAt:  c.expiresAt,
		lastSeenAt: c.lastSeenAt,
	}, nil
}

func (classificationTestConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return classificationTestResult{}, nil
}

type classificationTestRows struct {
	expiresAt  string
	lastSeenAt string
	returned   bool
}

func (*classificationTestRows) Columns() []string {
	return []string{"status", "expires_at", "last_seen_at", "account_type", "demo_expires_at"}
}

func (r *classificationTestRows) Close() error {
	r.returned = true
	return nil
}

func (r *classificationTestRows) Next(dest []driver.Value) error {
	if r.returned {
		return io.EOF
	}
	r.returned = true
	dest[0] = "active"
	dest[1] = r.expiresAt
	dest[2] = r.lastSeenAt
	dest[3] = "regular"
	dest[4] = nil
	return nil
}

type classificationTestResult struct{}

func (classificationTestResult) LastInsertId() (int64, error) { return 0, nil }
func (classificationTestResult) RowsAffected() (int64, error) { return 1, nil }

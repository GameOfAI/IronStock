package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeDB satisfies DBPinger for tests without a real database.
type fakeDB struct {
	err error
}

func (f *fakeDB) Ping(_ context.Context) error { return f.err }

func newTestRouter(db DBPinger) http.Handler {
	return NewRouter(Deps{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
}

func TestRouter_Healthz_Returns200(t *testing.T) {
	r := newTestRouter(&fakeDB{})
	rec := doRequest(r, http.MethodGet, "/healthz")
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200, body=%s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestRouter_Readyz_DBHealthy_Returns200(t *testing.T) {
	r := newTestRouter(&fakeDB{})
	rec := doRequest(r, http.MethodGet, "/readyz")
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200, body=%s", rec.Code, rec.Body)
	}
}

func TestRouter_Readyz_DBDown_Returns503(t *testing.T) {
	r := newTestRouter(&fakeDB{err: errors.New("connection refused")})
	rec := doRequest(r, http.MethodGet, "/readyz")
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}

func TestRouter_RequestIDMiddleware_AddsHeader(t *testing.T) {
	r := newTestRouter(&fakeDB{})
	rec := doRequest(r, http.MethodGet, "/healthz")
	if rec.Header().Get("X-Request-Id") == "" {
		t.Error("X-Request-Id header missing — middleware.RequestID not applied")
	}
}

func TestRouter_UnknownPath_Returns404(t *testing.T) {
	r := newTestRouter(&fakeDB{})
	rec := doRequest(r, http.MethodGet, "/no-such-path")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestRouter_HealthzPostNotAllowed_Returns405(t *testing.T) {
	r := newTestRouter(&fakeDB{})
	rec := doRequest(r, http.MethodPost, "/healthz")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405 (Method Not Allowed)", rec.Code)
	}
}

func doRequest(h http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

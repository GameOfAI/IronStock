package httpapi_test

// PR-DP01: item_annotations endpoint compile + permission guard tests.

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// TestAnnotationHandlers_Compile verifies AnnotationHandlers satisfies the
// interface expected by Deps — no runtime dependencies needed.
func TestAnnotationHandlers_Compile(t *testing.T) {
	t.Parallel()

	var h *httpapi.AnnotationHandlers

	// All three methods must exist with the correct signature.
	_ = http.HandlerFunc(h.ListAnnotations)
	_ = http.HandlerFunc(h.UpsertAnnotation)
	_ = http.HandlerFunc(h.DeleteAnnotation)
}

// TestAnnotationHandlers_RequiresAuth ensures endpoints return 401 when no
// auth token is present (no DB wiring required — claims are nil in context).
func TestAnnotationHandlers_RequiresAuth(t *testing.T) {
	t.Parallel()

	h := &httpapi.AnnotationHandlers{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	endpoints := []struct {
		method string
		fn     http.HandlerFunc
	}{
		{"GET", h.ListAnnotations},
		{"PUT", h.UpsertAnnotation},
		{"DELETE", h.DeleteAnnotation},
	}

	for _, ep := range endpoints {
		ep := ep
		t.Run(ep.method, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(ep.method, "/api/v1/items/some-id/annotations", nil)
			w := httptest.NewRecorder()
			ep.fn(w, req) // no auth middleware — claims context key absent
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("want 401 Unauthorized, got %d", w.Code)
			}
		})
	}
}

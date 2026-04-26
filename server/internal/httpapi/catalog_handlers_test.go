package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/auth"
)

// TestMyKeypairResponse_JSONShape pins the wire format. PR-W2 (Mac) writes
// TS DTOs from these field names; if they drift the client breaks.
func TestMyKeypairResponse_JSONShape(t *testing.T) {
	rotated := "2026-04-27T10:00:00Z"
	resp := myKeypairResponse{
		PublicKey:     []byte{1, 2, 3, 4},
		PrivateKeyEnc: []byte{5, 6, 7, 8},
		KEKSalt:       []byte{9, 10, 11, 12},
		KEKParams:     json.RawMessage(`{"t":3,"m":65536,"p":4,"v":1,"salt_b64":"abc"}`),
		Version:       2,
		RotatedAt:     &rotated,
	}
	js, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	body := string(js)

	for _, want := range []string{
		`"public_key":`,
		`"private_key_enc":`,
		`"kek_salt":`,
		`"kek_params":`,
		`"version":2`,
		`"rotated_at":"2026-04-27T10:00:00Z"`,
		`{"t":3,"m":65536,"p":4,"v":1,"salt_b64":"abc"}`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s in:\n%s", want, body)
		}
	}
}

// TestMyKeypairResponse_OmitsRotatedAtWhenNil — rotated_at is omitempty so
// brand-new accounts (never rotated) don't carry a null field that the
// client would have to filter out.
func TestMyKeypairResponse_OmitsRotatedAtWhenNil(t *testing.T) {
	resp := myKeypairResponse{
		PublicKey:     []byte{1},
		PrivateKeyEnc: []byte{2},
		KEKSalt:       []byte{3},
		KEKParams:     json.RawMessage(`{}`),
		Version:       1,
		// RotatedAt nil
	}
	js, _ := json.Marshal(resp)
	if strings.Contains(string(js), "rotated_at") {
		t.Errorf("rotated_at present despite nil:\n%s", js)
	}
}

// TestRouting_MeKeypair_DoesNotCollideWithPublicKey verifies that
// /users/me/keypair literal-matches BEFORE /users/{id}/public-key tries
// to bind id="me" (which would 404 anyway since "me" isn't a UUID).
//
// Sanity check: chi specific-before-generic ordering.
func TestRouting_MeKeypair_DoesNotCollideWithPublicKey(t *testing.T) {
	r := chi.NewRouter()
	hit := ""
	r.Get("/users/me/keypair", func(w http.ResponseWriter, _ *http.Request) {
		hit = "me"
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/users/{id}/public-key", func(w http.ResponseWriter, _ *http.Request) {
		hit = "byid"
		w.WriteHeader(http.StatusOK)
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/me/keypair", nil))
	if hit != "me" {
		t.Errorf("/users/me/keypair routed to %q, want me", hit)
	}

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/01890dca-2200-7e85-9b1c-2c2bbf6bc65a/public-key", nil))
	if hit != "byid" {
		t.Errorf("/users/<uuid>/public-key routed to %q, want byid", hit)
	}
}

// TestGetMyKeypair_NoClaims verifies the handler bails on missing
// auth context (defense-in-depth — RequireAccessToken middleware is
// the primary gate).
func TestGetMyKeypair_NoClaims(t *testing.T) {
	h := &CatalogHandlers{} // service nil — handler should bail before DB
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/keypair", nil)
	w := httptest.NewRecorder()
	h.GetMyKeypair(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

// TestGetMyKeypair_ClaimsCtxKey ensures the ctx key remains the one the
// middleware sets — drift here silently breaks every authenticated handler.
func TestGetMyKeypair_ClaimsCtxKey(t *testing.T) {
	want := AuthContextKey("auth.claims")
	if CtxKeyClaims != want {
		t.Errorf("CtxKeyClaims = %q, want %q", CtxKeyClaims, want)
	}
	// And sanity: ClaimsFromContext can fish out a claims pointer.
	c := &auth.Claims{}
	c.Subject = "x"
	ctx := context.WithValue(context.Background(), CtxKeyClaims, c)
	if got := ClaimsFromContext(ctx); got == nil || got.Subject != "x" {
		t.Errorf("ClaimsFromContext returned %+v", got)
	}
}

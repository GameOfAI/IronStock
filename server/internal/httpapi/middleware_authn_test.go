package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"envanter.app/server/internal/auth"
)

func newTestSigner(t *testing.T) *auth.JWTSigner {
	t.Helper()
	secret := make([]byte, 32)
	for i := range secret {
		secret[i] = byte(i + 1)
	}
	s, err := auth.NewJWTSigner(secret)
	if err != nil {
		t.Fatalf("NewJWTSigner: %v", err)
	}
	return s
}

func TestRequireAccessToken_NoAuthHeader(t *testing.T) {
	signer := newTestSigner(t)
	mw := RequireAccessToken(signer)
	called := false
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { called = true }))

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
	if called {
		t.Error("next handler was called despite missing token")
	}
}

func TestRequireAccessToken_BearerPrefixMissing(t *testing.T) {
	signer := newTestSigner(t)
	mw := RequireAccessToken(signer)
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {}))

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "raw-token-no-bearer")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

func TestRequireAccessToken_BadToken(t *testing.T) {
	signer := newTestSigner(t)
	mw := RequireAccessToken(signer)
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {}))

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer not.a.jwt")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

func TestRequireAccessToken_WrongPurpose(t *testing.T) {
	signer := newTestSigner(t)
	tmp, err := signer.IssueTmp("user-123", auth.PurposeTOTPEnroll)
	if err != nil {
		t.Fatal(err)
	}

	mw := RequireAccessToken(signer)
	called := false
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { called = true }))

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tmp)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (wrong purpose)", w.Code)
	}
	if called {
		t.Error("next handler ran with tmp token")
	}
}

func TestRequireAccessToken_HappyPath(t *testing.T) {
	signer := newTestSigner(t)
	tok, err := signer.IssueAccess("user-123", "session-abc", []string{"write"})
	if err != nil {
		t.Fatal(err)
	}

	mw := RequireAccessToken(signer)
	var seenClaims *auth.Claims
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seenClaims = ClaimsFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if seenClaims == nil {
		t.Fatal("claims missing from ctx")
	}
	if seenClaims.Subject != "user-123" {
		t.Errorf("Subject = %q, want user-123", seenClaims.Subject)
	}
	if seenClaims.ID != "session-abc" {
		t.Errorf("ID (jti) = %q, want session-abc", seenClaims.ID)
	}
	if len(seenClaims.Roles) != 1 || seenClaims.Roles[0] != "write" {
		t.Errorf("Roles = %v, want [write]", seenClaims.Roles)
	}
}

func TestClaimsFromContext_Empty(t *testing.T) {
	if ClaimsFromContext(httptest.NewRequest(http.MethodGet, "/x", nil).Context()) != nil {
		t.Error("expected nil from empty ctx")
	}
}

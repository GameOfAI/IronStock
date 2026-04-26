package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"envanter.app/server/internal/auth"
)

// inject builds a request with the given roles already in claims context,
// so RequireRole can be exercised without RequireAccessToken in front.
func inject(roles []string) *http.Request {
	claims := &auth.Claims{Roles: roles}
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	ctx := context.WithValue(r.Context(), CtxKeyClaims, claims)
	return r.WithContext(ctx)
}

func TestPermission_Allows(t *testing.T) {
	cases := []struct {
		have, want Permission
		ok         bool
	}{
		{PermissionWrite, PermissionWrite, true},
		{PermissionWrite, PermissionRead, true},
		{PermissionRead, PermissionRead, true},
		{PermissionRead, PermissionWrite, false},
		{PermissionNone, PermissionRead, false},
		{PermissionNone, PermissionWrite, false},
	}
	for _, tc := range cases {
		if got := tc.have.Allows(tc.want); got != tc.ok {
			t.Errorf("Permission(%q).Allows(%q) = %v, want %v", tc.have, tc.want, got, tc.ok)
		}
	}
}

func TestRequireRole_NoClaims(t *testing.T) {
	mw := RequireRole(RoleAdmin)
	called := false
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { called = true }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
	if called {
		t.Error("handler ran without claims")
	}
}

func TestRequireRole_AdminBypass(t *testing.T) {
	mw := RequireRole(RoleRead) // explicit allow=read; admin should still pass
	called := false
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { called = true }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, inject([]string{RoleAdmin}))
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 (admin bypass)", w.Code)
	}
	if !called {
		t.Error("admin claims rejected")
	}
}

func TestRequireRole_AllowedIntersect(t *testing.T) {
	mw := RequireRole(RoleWrite)
	called := false
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { called = true }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, inject([]string{RoleWrite}))
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if !called {
		t.Error("matching role rejected")
	}
}

func TestRequireRole_NotInSet(t *testing.T) {
	mw := RequireRole(RoleWrite)
	called := false
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { called = true }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, inject([]string{RoleRead}))
	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Code)
	}
	if called {
		t.Error("handler ran for unauthorized role")
	}
}

func TestRequireRole_EmptyClaims(t *testing.T) {
	mw := RequireRole(RoleRead)
	w := httptest.NewRecorder()
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {}))
	h.ServeHTTP(w, inject(nil))
	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Code)
	}
}

func TestHasRole(t *testing.T) {
	c := &auth.Claims{Roles: []string{"read", "admin"}}
	if !hasRole(c, "admin") {
		t.Error("admin not detected")
	}
	if hasRole(c, "write") {
		t.Error("write incorrectly detected")
	}
	if hasRole(&auth.Claims{}, "admin") {
		t.Error("admin detected on empty claims")
	}
}

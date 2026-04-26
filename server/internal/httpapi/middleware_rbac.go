package httpapi

// RBAC layer. PR-7 ships ONLY the role-bearer middleware (claims-based).
// Item / folder permission resolvers (DB-backed effective permission walk)
// land in PR-8 alongside the Item CRUD endpoints that consume them.
//
// The Permission type and its constants live here so PR-8 SQL helpers can
// import a stable contract (no breakage when the resolvers arrive).

import (
	"net/http"

	"envanter.app/server/internal/auth"
)

// Permission is the effective access level a user has on a resource
// (folder or item). Computed by ResolveItemPermission /
// ResolveFolderPermission (PR-8) by merging:
//
//  1. global role  — admin bypasses all checks (returns Write).
//  2. item_shares  — explicit per-user grant on a specific item.
//  3. folder_permissions — inherited from any ancestor folder where
//     inherit_to_children = true.
//
// The final value is the strongest of the three.
type Permission string

// Permission constants — string values are deliberately lowercase to match
// the SQL CHECK on item_shares.permission and folder_permissions.permission.
const (
	PermissionNone  Permission = ""      // user has no access
	PermissionRead  Permission = "read"  // can view item / list folder
	PermissionWrite Permission = "write" // can edit, delete, share
)

// Allows reports whether holding p satisfies a request needing want.
// Write-needing requests need PermissionWrite; read-needing accept either.
func (p Permission) Allows(want Permission) bool {
	switch want {
	case PermissionWrite:
		return p == PermissionWrite
	case PermissionRead:
		return p == PermissionRead || p == PermissionWrite
	}
	return false
}

// Standard role names — must match the seed in migrations/00003_roles.sql.
const (
	RoleAdmin = "admin"
	RoleWrite = "write"
	RoleRead  = "read"
)

// RequireRole returns a middleware that checks the request's auth claims
// against the allowed role set. Admin bypasses every check. Anything else
// must intersect with `allowed`.
//
// Must be composed AFTER RequireAccessToken so claims are in context.
//
// Usage:
//
//	r.With(RequireAccessToken(signer)).Group(func(r chi.Router) {
//	    r.With(RequireRole(RoleAdmin)).Get("/admin/users", ...)
//	    r.With(RequireRole(RoleAdmin, RoleWrite)).Post("/items", ...)
//	})
func RequireRole(allowed ...string) func(http.Handler) http.Handler {
	allowSet := make(map[string]struct{}, len(allowed))
	for _, r := range allowed {
		allowSet[r] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := ClaimsFromContext(r.Context())
			if claims == nil {
				writeMiddlewareUnauthorized(w, errAuthCtxMissing)
				return
			}
			if hasRole(claims, RoleAdmin) {
				next.ServeHTTP(w, r)
				return
			}
			for _, role := range claims.Roles {
				if _, ok := allowSet[role]; ok {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeMiddlewareForbidden(w)
		})
	}
}

// hasRole reports whether the claims include the named role.
func hasRole(claims *auth.Claims, role string) bool {
	for _, r := range claims.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// errAuthCtxMissing is the placeholder error logged when RequireRole runs
// without claims in context. Means the caller forgot to chain
// RequireAccessToken first. We treat it as 401 to be safe (deny by default).
var errAuthCtxMissing = errAuth("auth claims missing from context")

type errAuth string

func (e errAuth) Error() string { return string(e) }

func writeMiddlewareForbidden(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte(`{"code":"forbidden","message":"Bu işlem için yetkiniz yok."}`))
}

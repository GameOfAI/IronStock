package httpapi

import (
	"context"
	"errors"
	"net/http"

	"envanter.app/server/internal/auth"
)

// AuthContextKey is the type for keys we store on request context.
//
// Using a named type rather than `string` prevents accidental collisions
// with other packages' context keys (Go contract).
type AuthContextKey string

const (
	// CtxKeyClaims holds *auth.Claims for handlers that ran through
	// RequireAccessToken.
	CtxKeyClaims AuthContextKey = "auth.claims"
)

// RequireAccessToken returns a middleware that validates a Bearer access
// token in Authorization. On success it stows *auth.Claims under
// CtxKeyClaims; on failure it writes 401 and stops the chain.
//
// Use this for endpoints that any authenticated user can reach. Add
// role / permission checks on top in PR-7+.
func RequireAccessToken(signer *auth.JWTSigner) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authz := r.Header.Get("Authorization")
			const prefix = "Bearer "
			if len(authz) <= len(prefix) || authz[:len(prefix)] != prefix {
				writeMiddlewareUnauthorized(w, errors.New("authorization header missing"))
				return
			}
			token := authz[len(prefix):]
			claims, err := signer.Parse(token, auth.PurposeAccess)
			if err != nil {
				writeMiddlewareUnauthorized(w, err)
				return
			}
			ctx := context.WithValue(r.Context(), CtxKeyClaims, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClaimsFromContext retrieves the auth claims set by RequireAccessToken.
// Returns nil if no claims (handler was reachable without the middleware).
func ClaimsFromContext(ctx context.Context) *auth.Claims {
	v, _ := ctx.Value(CtxKeyClaims).(*auth.Claims)
	return v
}

// writeMiddlewareUnauthorized writes a minimal 401 without going through the
// per-handler logger. Middleware errors are normal/loud — we don't bury them
// under warn.
func writeMiddlewareUnauthorized(w http.ResponseWriter, _ error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"code":"unauthorized","message":"Token gerekli."}`))
}

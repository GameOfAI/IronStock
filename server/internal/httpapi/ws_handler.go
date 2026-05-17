package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/coder/websocket"

	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/ws"
)

// WSHandlers groups the WebSocket-related HTTP handlers.
type WSHandlers struct {
	Service *auth.Service
	Hub     *ws.Hub
	Tickets *ws.TicketStore
	Logger  *slog.Logger
}

// IssueTicket implements POST /api/v1/ws/ticket.
//
// Auth: Bearer access token (standard Authorization header).
//
// Response: {"ticket": "<64-hex-char>"}
//
// The returned ticket is a cryptographically random, single-use, 30-second
// TTL credential that the client passes as ?ticket= on the WS upgrade URL.
// This avoids placing the long-lived access token in the URL query string
// where it would appear in proxy logs, CDN access logs, and browser history.
//
// Clients MUST request a fresh ticket on every (re-)connect attempt.
func (h *WSHandlers) IssueTicket(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Access token gerekli.", errors.New("no claims in context"))
		return
	}

	ticket, err := h.Tickets.Issue(claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ticket üretilemedi.", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"ticket": ticket})
}

// Connect implements GET /api/v1/ws.
//
// Auth: one-time ticket in ?ticket= query param (primary, preferred).
//   - Obtained via POST /api/v1/ws/ticket (Bearer-authenticated).
//   - Ticket is consumed on use; client must re-issue for each reconnect.
//
// Auth: Bearer access token in Authorization header (secondary, for
// server-to-server / test tooling that cannot use the ticket flow).
//
// On success: upgrades to WebSocket, registers with the hub, blocks until
// the client disconnects.
//
// SECURITY NOTES:
//   - Ticket is single-use and 30-second TTL — low exposure window even if
//     intercepted in transit.
//   - The legacy ?access_token= query-param path has been removed. Long-lived
//     tokens in URLs are a credential-exposure anti-pattern (appear in proxy
//     logs, CDN access logs, and browser history).
//   - We do NOT echo any data back beyond hub-pushed events.
//   - Access-token expiry does NOT close an established connection (would force
//     browser reconnect every 15 min). Faz 5 follow-up: periodic re-auth ping.
func (h *WSHandlers) Connect(w http.ResponseWriter, r *http.Request) {
	userID, err := h.resolveConnectAuth(r)
	if err != nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Kimlik doğrulama başarısız (ticket veya Authorization header gerekli).", err)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// OriginPatterns: allow any localhost port so the Vite dev-server proxy
		// (localhost:5173 → localhost:8080) and the nginx docker proxy both work.
		// For production behind a reverse proxy, the real protection is the
		// ticket-based auth already enforced in resolveConnectAuth above.
		// Faz 5: tighten to known production origin(s) via env config.
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
		Subprotocols:   []string{"envanter.v1"},
	})
	if err != nil {
		// websocket.Accept already wrote a response on failure.
		h.Logger.Warn("ws upgrade failed", slog.String("error", err.Error()))
		return
	}

	c := h.Hub.Accept(conn, userID)
	release := h.Hub.Register(c)
	defer release()

	// Park the HTTP request goroutine until the WS connection ends. The
	// reader/writer goroutines anchor on the hub's lifetime context (NOT
	// the request context), so chi's Timeout middleware can fire on this
	// request without tearing the conn down.
	<-c.Closed()
}

// resolveConnectAuth determines the userID for an incoming WS upgrade request.
//
// Priority:
//  1. ?ticket= query param (primary — browser clients use the ticket flow)
//  2. Authorization: Bearer <token> header (secondary — server-to-server / tooling)
func (h *WSHandlers) resolveConnectAuth(r *http.Request) (string, error) {
	// 1. Ticket path (primary — browsers can't set custom headers on WS).
	if ticket := r.URL.Query().Get("ticket"); ticket != "" {
		userID, ok := h.Tickets.Consume(ticket)
		if !ok {
			return "", errors.New("ticket geçersiz, süresi dolmuş veya zaten kullanılmış")
		}
		return userID, nil
	}

	// 2. Bearer token path (server-to-server / CLI / test tooling).
	authz := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(authz) > len(prefix) && authz[:len(prefix)] == prefix {
		token := authz[len(prefix):]
		claims, err := h.Service.JWT.Parse(token, auth.PurposeAccess)
		if err != nil {
			return "", err
		}
		return claims.Subject, nil
	}

	return "", errors.New("ticket veya Authorization header gerekli")
}

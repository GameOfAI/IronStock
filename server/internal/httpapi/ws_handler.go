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
	Logger  *slog.Logger
}

// Connect implements GET /api/v1/ws.
//
// Auth: Bearer access token in Authorization header (browsers can't set
// custom headers on WebSocket; clients fall back to a query-param token
// for native clients but the browser path goes through a same-origin
// fetch upgrade with the cookie/header chain — Faz 3 web client decides).
//
// On success: upgrades to WebSocket, registers with the hub, blocks until
// the client disconnects.
//
// SECURITY: We do NOT echo any data back on this connection beyond hub-
// pushed events. The token is validated once at upgrade and the connection
// inherits the user identity for its lifetime; access-token expiry does
// NOT close the connection automatically (would force browser reconnect
// every 15min). Faz 5 follow-up: periodic re-auth check.
func (h *WSHandlers) Connect(w http.ResponseWriter, r *http.Request) {
	authz := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !(len(authz) > len(prefix) && authz[:len(prefix)] == prefix) {
		// Browser fallback (?access_token=... via Sec-WebSocket-Protocol)
		// is left for Faz 3 web client decision; for now we only accept
		// the Authorization header.
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Authorization header eksik.", errors.New("no bearer"))
		return
	}
	token := authz[len(prefix):]

	claims, err := h.Service.JWT.Parse(token, auth.PurposeAccess)
	if err != nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeInvalidToken,
			"Token geçersiz.", err)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Faz 5: tighten OriginPatterns to known frontend origin(s).
		// MVP: same-origin only (default behavior when OriginPatterns is nil).
		Subprotocols: []string{"envanter.v1"},
	})
	if err != nil {
		// websocket.Accept already wrote a response on failure.
		h.Logger.Warn("ws upgrade failed", slog.String("error", err.Error()))
		return
	}

	c := h.Hub.Accept(conn, claims.Subject)
	release := h.Hub.Register(c)
	defer release()

	// Park the HTTP request goroutine until the WS connection ends. The
	// reader/writer goroutines anchor on the hub's lifetime context (NOT
	// the request context), so chi's Timeout middleware can fire on this
	// request without tearing the conn down.
	<-c.Closed()
}

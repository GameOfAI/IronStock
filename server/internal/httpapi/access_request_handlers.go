package httpapi

// PR-N3: Onay/Checkout Workflow handlers.
//
// Flow:
//  1. Admin marks item requires_approval=true via PATCH /api/v1/items/{id}/approval-required.
//  2. Non-owner user calls GET /api/v1/items/{id} — gets metadata but NOT fields;
//     fields are omitted when requires_approval=true and no active approved request exists.
//  3. User creates request: POST /api/v1/items/{id}/access-requests.
//  4. Admin sees pending requests at GET /api/v1/access-requests.
//     WS event "access_request.created" fires → admin gets in-app notification.
//  5. Admin approves (POST .../approve) or denies (POST .../deny).
//     WS event fires → requester's client invalidates item cache.
//  6. Within the window (status='approved' AND expires_at > NOW()) the user
//     can call GET /api/v1/items/{id} and receive full fields.

import (
	"context"
	"errors"
	"net/http"
	"time"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/ws"
	"github.com/go-chi/chi/v5"
)

// ---- error codes ----

const (
	// ErrCodeApprovalRequired: item has requires_approval=true and the caller
	// has no active approved access request. Fields are omitted from the response.
	ErrCodeApprovalRequired = "approval_required"
)

// ---- request / response shapes ----

type createAccessRequestInput struct {
	Reason                string `json:"reason"`
	AccessDurationMinutes int    `json:"access_duration_minutes"`
}

type approveAccessRequestInput struct {
	// Optional override of requester's requested duration.
	AccessDurationMinutes *int `json:"access_duration_minutes,omitempty"`
}

type denyAccessRequestInput struct {
	Reason string `json:"reason"`
}

// AccessRequestInfo is the embedded access-request info returned inside an
// itemResponse when requires_approval=true.
type AccessRequestInfo struct {
	ID                    string  `json:"id"`
	Status                string  `json:"status"`
	AccessDurationMinutes int     `json:"access_duration_minutes"`
	RequestedAt           string  `json:"requested_at"`
	RespondedAt           *string `json:"responded_at,omitempty"`
	ExpiresAt             *string `json:"expires_at,omitempty"`
	DenyReason            *string `json:"deny_reason,omitempty"`
}

type accessRequestListItem struct {
	ID                    string  `json:"id"`
	ItemID                string  `json:"item_id"`
	ItemName              string  `json:"item_name,omitempty"`
	RequesterID           string  `json:"requester_id"`
	RequesterName         string  `json:"requester_name,omitempty"`
	Status                string  `json:"status"`
	Reason                *string `json:"reason,omitempty"`
	DenyReason            *string `json:"deny_reason,omitempty"`
	AccessDurationMinutes int     `json:"access_duration_minutes"`
	RequestedAt           string  `json:"requested_at"`
	RespondedAt           *string `json:"responded_at,omitempty"`
	ApprovedBy            *string `json:"approved_by,omitempty"`
	ExpiresAt             *string `json:"expires_at,omitempty"`
}

type accessRequestsListResponse struct {
	Requests []accessRequestListItem `json:"requests"`
}

// ---- helper: approval gate check ----

// hasActiveApproval returns true when userID has a non-expired approved
// access request for itemID. Also transitions stale approved → expired on read.
func hasActiveApproval(ctx context.Context, db auth.DBExec, itemID, userID string) (bool, error) {
	// Expire stale approved requests first (best-effort, ignore error).
	_, _ = db.Exec(ctx,
		`UPDATE access_requests SET status = 'expired'
		 WHERE item_id = $1::uuid AND requester_id = $2::uuid
		   AND status = 'approved' AND expires_at <= NOW()`,
		itemID, userID,
	)

	const sql = `
		SELECT EXISTS (
			SELECT 1 FROM access_requests
			WHERE item_id = $1::uuid
			  AND requester_id = $2::uuid
			  AND status = 'approved'
			  AND expires_at > NOW()
		)
	`
	var ok bool
	err := db.QueryRow(ctx, sql, itemID, userID).Scan(&ok)
	return ok, err
}

// fetchMyAccessRequest returns the most recent access request for userID + itemID
// (any status). Returns nil when none found.
func fetchMyAccessRequest(ctx context.Context, db auth.DBExec, itemID, userID string) *AccessRequestInfo {
	const sql = `
		SELECT id::text, status, access_duration_minutes,
		       requested_at::text, responded_at::text, expires_at::text, deny_reason
		FROM access_requests
		WHERE item_id = $1::uuid AND requester_id = $2::uuid
		ORDER BY requested_at DESC
		LIMIT 1
	`
	var ar AccessRequestInfo
	err := db.QueryRow(ctx, sql, itemID, userID).Scan(
		&ar.ID, &ar.Status, &ar.AccessDurationMinutes,
		&ar.RequestedAt, &ar.RespondedAt, &ar.ExpiresAt, &ar.DenyReason,
	)
	if err != nil {
		return nil
	}
	return &ar
}

// ---- handlers ----

// CreateAccessRequest implements POST /api/v1/items/{id}/access-requests.
//
// Any authenticated user with at least read permission on the item may request
// access. Only one pending request per (item, requester) is allowed (returns 409).
func (h *ItemHandlers) CreateAccessRequest(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	var req createAccessRequestInput
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.AccessDurationMinutes <= 0 {
		req.AccessDurationMinutes = 60
	}
	if req.AccessDurationMinutes > 1440 {
		req.AccessDurationMinutes = 1440 // cap at 24 h
	}

	// Requester must have at least read permission on the item.
	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil || !p.AllowsRead() {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Item bulunamadı.", errors.New("denied"))
			return
		}
	}

	const sql = `
		INSERT INTO access_requests
			(item_id, requester_id, reason, access_duration_minutes)
		VALUES ($1::uuid, $2::uuid, NULLIF($3,''), $4)
		RETURNING id::text, requested_at::text
	`
	var reqID, requestedAt string
	err := h.Service.DB.QueryRow(ctx, sql,
		itemID, claims.Subject, req.Reason, req.AccessDurationMinutes,
	).Scan(&reqID, &requestedAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu item için zaten bekleyen bir onay isteğiniz var.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Onay isteği oluşturulamadı.", err)
		return
	}

	// WS: notify all connected admins.
	h.publishEvent(ws.EventAccessRequestCreated, reqID, claims.Subject)

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAccessRequestCreated,
		ResourceType: "access_request",
		ResourceID:   reqID,
		Details: map[string]any{
			"item_id":                 itemID,
			"access_duration_minutes": req.AccessDurationMinutes,
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, accessRequestListItem{
		ID:                    reqID,
		ItemID:                itemID,
		RequesterID:           claims.Subject,
		Status:                "pending",
		AccessDurationMinutes: req.AccessDurationMinutes,
		RequestedAt:           requestedAt,
	})
}

// ListAccessRequests implements GET /api/v1/access-requests.
//
// Admin: all requests, pending first then newest.
// Regular user: only own requests.
// Query params: status (filter), item_id (filter).
func (h *ItemHandlers) ListAccessRequests(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	ctx := r.Context()
	statusFilter := r.URL.Query().Get("status")
	itemFilter := r.URL.Query().Get("item_id")
	isAdmin := hasRole(claims, RoleAdmin)

	const sql = `
		SELECT
			ar.id::text,
			ar.item_id::text,
			COALESCE(i.name_plain, '') AS item_name,
			ar.requester_id::text,
			COALESCE(u.username, '') AS requester_name,
			ar.status,
			ar.reason,
			ar.deny_reason,
			ar.access_duration_minutes,
			ar.requested_at::text,
			ar.responded_at::text,
			ar.approved_by::text,
			ar.expires_at::text
		FROM access_requests ar
		JOIN items i ON i.id = ar.item_id
		JOIN users u ON u.id = ar.requester_id
		WHERE
			($1 OR ar.requester_id = $2::uuid)
			AND ($3 = '' OR ar.status = $3)
			AND ($4 = '' OR ar.item_id::text = $4)
		ORDER BY
			(ar.status = 'pending') DESC,
			ar.requested_at DESC
		LIMIT 200
	`
	rows, err := h.Service.DB.Query(ctx, sql,
		isAdmin, claims.Subject, statusFilter, itemFilter,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İstekler listelenemedi.", err)
		return
	}
	defer rows.Close()

	list := make([]accessRequestListItem, 0)
	for rows.Next() {
		var ar accessRequestListItem
		if err := rows.Scan(
			&ar.ID, &ar.ItemID, &ar.ItemName,
			&ar.RequesterID, &ar.RequesterName,
			&ar.Status, &ar.Reason, &ar.DenyReason,
			&ar.AccessDurationMinutes, &ar.RequestedAt,
			&ar.RespondedAt, &ar.ApprovedBy, &ar.ExpiresAt,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Satır okunamadı.", err)
			return
		}
		list = append(list, ar)
	}
	writeJSON(w, http.StatusOK, accessRequestsListResponse{Requests: list})
}

// ApproveAccessRequest implements POST /api/v1/access-requests/{req_id}/approve.
// Admin only.
func (h *ItemHandlers) ApproveAccessRequest(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	if !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Admin yetkisi gerekli.", errors.New("not admin"))
		return
	}
	reqID := chi.URLParam(r, "req_id")
	ctx := r.Context()

	// body is optional — ignore decode error
	var body approveAccessRequestInput
	_ = decodeJSON(w, r, h.Logger, &body)

	// Fetch the pending request.
	const fetchSQL = `
		SELECT requester_id::text, item_id::text, access_duration_minutes
		FROM access_requests
		WHERE id = $1::uuid AND status = 'pending'
		LIMIT 1
	`
	var requesterID, itemID string
	var durationMin int
	if err := h.Service.DB.QueryRow(ctx, fetchSQL, reqID).Scan(
		&requesterID, &itemID, &durationMin,
	); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Bekleyen onay isteği bulunamadı.", err)
		return
	}

	// Admin may override requested duration.
	if body.AccessDurationMinutes != nil && *body.AccessDurationMinutes > 0 {
		durationMin = *body.AccessDurationMinutes
	}
	if durationMin > 1440 {
		durationMin = 1440
	}
	expiresAt := time.Now().UTC().Add(time.Duration(durationMin) * time.Minute)

	const updateSQL = `
		UPDATE access_requests
		SET status = 'approved',
		    approved_by = $2::uuid,
		    responded_at = NOW(),
		    expires_at = $3,
		    access_duration_minutes = $4
		WHERE id = $1::uuid AND status = 'pending'
	`
	tag, err := h.Service.DB.Exec(ctx, updateSQL, reqID, claims.Subject, expiresAt, durationMin)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
			"İstek onaylanamadı (zaten işlenmiş olabilir).", err)
		return
	}

	// WS: notify requester their request was approved.
	h.publishEvent(ws.EventAccessRequestApproved, reqID, claims.Subject)

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAccessRequestApproved,
		ResourceType: "access_request",
		ResourceID:   reqID,
		Details: map[string]any{
			"item_id":      itemID,
			"requester_id": requesterID,
			"duration_min": durationMin,
			"expires_at":   expiresAt.Format(time.RFC3339),
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// DenyAccessRequest implements POST /api/v1/access-requests/{req_id}/deny.
// Admin only.
func (h *ItemHandlers) DenyAccessRequest(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	if !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Admin yetkisi gerekli.", errors.New("not admin"))
		return
	}
	reqID := chi.URLParam(r, "req_id")
	ctx := r.Context()

	var body denyAccessRequestInput
	if !decodeJSON(w, r, h.Logger, &body) {
		return
	}

	const fetchSQL = `
		SELECT requester_id::text, item_id::text
		FROM access_requests
		WHERE id = $1::uuid AND status = 'pending'
		LIMIT 1
	`
	var requesterID, itemID string
	if err := h.Service.DB.QueryRow(ctx, fetchSQL, reqID).Scan(&requesterID, &itemID); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Bekleyen onay isteği bulunamadı.", err)
		return
	}

	const updateSQL = `
		UPDATE access_requests
		SET status = 'denied', deny_reason = $2, responded_at = NOW()
		WHERE id = $1::uuid AND status = 'pending'
	`
	tag, err := h.Service.DB.Exec(ctx, updateSQL, reqID, body.Reason)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
			"İstek reddedilemedi.", err)
		return
	}

	h.publishEvent(ws.EventAccessRequestDenied, reqID, claims.Subject)

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAccessRequestDenied,
		ResourceType: "access_request",
		ResourceID:   reqID,
		Details:      map[string]any{"item_id": itemID, "requester_id": requesterID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// CancelAccessRequest implements DELETE /api/v1/access-requests/{req_id}.
// Requester can cancel their own pending request.
func (h *ItemHandlers) CancelAccessRequest(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	reqID := chi.URLParam(r, "req_id")
	ctx := r.Context()

	const sql = `
		UPDATE access_requests
		SET status = 'cancelled', responded_at = NOW()
		WHERE id = $1::uuid AND requester_id = $2::uuid AND status = 'pending'
	`
	tag, err := h.Service.DB.Exec(ctx, sql, reqID, claims.Subject)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Bekleyen onay isteği bulunamadı.", errors.New("not found or not pending"))
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAccessRequestCancelled,
		ResourceType: "access_request",
		ResourceID:   reqID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// ToggleApprovalRequired implements PATCH /api/v1/items/{id}/approval-required.
// Admin only. Body: {"required": true|false}
func (h *ItemHandlers) ToggleApprovalRequired(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	if !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Admin yetkisi gerekli.", errors.New("not admin"))
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	var body struct {
		Required bool `json:"required"`
	}
	if !decodeJSON(w, r, h.Logger, &body) {
		return
	}

	const sql = `UPDATE items SET requires_approval = $2 WHERE id = $1::uuid`
	if _, err := h.Service.DB.Exec(ctx, sql, itemID, body.Required); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Güncelleme başarısız.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemApprovalToggled,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"requires_approval": body.Required},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

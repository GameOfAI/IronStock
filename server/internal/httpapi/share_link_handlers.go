package httpapi

// PR-N5: One-time share links — a creator wraps the item DEK with a random
// link_key (embedded in the URL fragment, never sent to server), stores the
// wrapped blob, and the public endpoint returns encrypted item data that the
// browser decrypts using the link_key.
//
// Endpoints:
//   POST   /api/v1/items/{id}/share-links           → create (auth, write permission)
//   GET    /api/v1/items/{id}/share-links           → list active (auth, write permission)
//   DELETE /api/v1/items/{id}/share-links/{link_id} → revoke (auth, write permission)
//   GET    /api/v1/share/{token}                    → public view (no auth)

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// ShareLinkHandlers provides the share-link CRUD + public view endpoints.
type ShareLinkHandlers struct {
	DB      *pgxpool.Pool
	Service *auth.Service // for master-cipher item-name decryption
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// ── helpers ──────────────────────────────────────────────────────────────────

// generateShareToken returns (rawToken base64url, SHA-256 hash 32B, err).
func generateShareToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256(raw)
	return token, sum[:], nil
}

func hashShareToken(raw string) []byte {
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(b) != 32 {
		return nil
	}
	sum := sha256.Sum256(b)
	return sum[:]
}

// parseTTL maps a user-supplied string to a duration. Unknown → 24h.
func parseTTL(s string) time.Duration {
	switch strings.ToLower(s) {
	case "1h":
		return time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	default: // "1d" and anything else
		return 24 * time.Hour
	}
}

// ── create ────────────────────────────────────────────────────────────────────

type createShareLinkRequest struct {
	DEKWrapped string `json:"dek_wrapped"` // base64 — item DEK encrypted with link_key
	ExpiresIn  string `json:"expires_in"`  // "1h" | "1d" | "7d"
	ViewLimit  int    `json:"view_limit"`  // 1-10
}

type createShareLinkResponse struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expires_at"` // RFC 3339
}

// CreateShareLink implements POST /api/v1/items/{id}/share-links.
func (h *ShareLinkHandlers) CreateShareLink(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	// Write permission required.
	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Yetki sorgulanamadı.", err)
			return
		}
		if !p.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized, "Bu item üzerinde yazma yetkiniz yok.", errors.New("write denied"))
			return
		}
	}

	var req createShareLinkRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.DEKWrapped == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "dek_wrapped zorunlu.", nil)
		return
	}
	if req.ViewLimit < 1 || req.ViewLimit > 10 {
		req.ViewLimit = 1
	}

	dekBytes, err := base64.StdEncoding.DecodeString(req.DEKWrapped)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "dek_wrapped geçerli base64 değil.", err)
		return
	}

	rawToken, tokenHash, err := generateShareToken()
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Token üretilemedi.", err)
		return
	}

	ttl := parseTTL(req.ExpiresIn)
	expiresAt := time.Now().Add(ttl)

	const insertSQL = `
		INSERT INTO item_share_links (item_id, token_hash, dek_wrapped, expires_at, view_limit, created_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
		RETURNING id::text
	`
	var linkID string
	err = h.DB.QueryRow(ctx, insertSQL,
		itemID, tokenHash, dekBytes, expiresAt, req.ViewLimit, claims.Subject,
	).Scan(&linkID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Link oluşturulamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionShareLinkCreated,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"link_id": linkID, "expires_in": req.ExpiresIn, "view_limit": req.ViewLimit},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, createShareLinkResponse{
		Token:     rawToken,
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	})
}

// ── list ──────────────────────────────────────────────────────────────────────

type shareLinkListItem struct {
	ID        string `json:"id"`
	ExpiresAt string `json:"expires_at"`
	ViewLimit int    `json:"view_limit"`
	ViewCount int    `json:"view_count"`
	CreatedAt string `json:"created_at"`
}

// ListShareLinks implements GET /api/v1/items/{id}/share-links.
func (h *ShareLinkHandlers) ListShareLinks(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Yetki sorgulanamadı.", err)
			return
		}
		if !p.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized, "Yetki yetersiz.", errors.New("write denied"))
			return
		}
	}

	const selectSQL = `
		SELECT id::text, expires_at, view_limit, view_count, created_at
		FROM item_share_links
		WHERE item_id = $1::uuid AND expires_at > now() AND view_count < view_limit
		ORDER BY created_at DESC
	`
	rows, err := h.DB.Query(ctx, selectSQL, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Linkler alınamadı.", err)
		return
	}
	defer rows.Close()

	links := make([]shareLinkListItem, 0)
	for rows.Next() {
		var l shareLinkListItem
		var expiresAt, createdAt time.Time
		if err := rows.Scan(&l.ID, &expiresAt, &l.ViewLimit, &l.ViewCount, &createdAt); err != nil {
			continue
		}
		l.ExpiresAt = expiresAt.UTC().Format(time.RFC3339)
		l.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		links = append(links, l)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Linkler okunamadı.", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"links": links})
}

// ── revoke ─────────────────────────────────────────────────────────────────────

// RevokeShareLink implements DELETE /api/v1/items/{id}/share-links/{link_id}.
func (h *ShareLinkHandlers) RevokeShareLink(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}
	itemID := chi.URLParam(r, "id")
	linkID := chi.URLParam(r, "link_id")
	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Yetki sorgulanamadı.", err)
			return
		}
		if !p.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized, "Yetki yetersiz.", errors.New("write denied"))
			return
		}
	}

	const deleteSQL = `DELETE FROM item_share_links WHERE id = $1::uuid AND item_id = $2::uuid`
	tag, err := h.DB.Exec(ctx, deleteSQL, linkID, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Link silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Link bulunamadı.", nil)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionShareLinkRevoked,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"link_id": linkID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// ── public view ───────────────────────────────────────────────────────────────

type shareLinkViewField struct {
	Key        string `json:"key"`
	Label      string `json:"label"`
	FieldType  string `json:"field_type"`
	IsSecret   bool   `json:"is_secret"`
	ValueEnc   []byte `json:"value_enc,omitempty"`
	ValueNonce []byte `json:"value_nonce,omitempty"`
}

type shareLinkViewResponse struct {
	ItemName      string               `json:"item_name"`       // server-decrypted
	ItemTypeLabel string               `json:"item_type_label"`
	Fields        []shareLinkViewField `json:"fields"`
	DEKWrapped    []byte               `json:"dek_wrapped"`     // base64; encrypted with link_key
	ExpiresAt     string               `json:"expires_at"`
	ViewsLeft     int                  `json:"views_left"`
}

// ViewShareLink implements GET /api/v1/share/{token} — public, no auth.
//
// Atomically increments view_count; returns 410 Gone when the link is
// expired or the view_limit has been reached.
func (h *ShareLinkHandlers) ViewShareLink(w http.ResponseWriter, r *http.Request) {
	rawToken := chi.URLParam(r, "token")
	tokenHash := hashShareToken(rawToken)
	if tokenHash == nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Link bulunamadı.", nil)
		return
	}

	ctx := r.Context()

	// Atomically increment view_count and read the link in one statement.
	const updateSQL = `
		UPDATE item_share_links
		SET view_count = view_count + 1
		WHERE token_hash = $1
		  AND expires_at > now()
		  AND view_count < view_limit
		RETURNING item_id::text, dek_wrapped, expires_at, view_limit, view_count
	`
	var linkItemID string
	var dekWrapped []byte
	var expiresAt time.Time
	var viewLimit, viewCount int

	err := h.DB.QueryRow(ctx, updateSQL, tokenHash).Scan(
		&linkItemID, &dekWrapped, &expiresAt, &viewLimit, &viewCount,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusGone, "link_expired",
				"Bu link kullanılmış, süresi dolmuş veya geçersiz.", nil)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Link sorgulanamadı.", err)
		return
	}

	// Fetch item metadata + fields for the response.
	name, typeLabel, fields, err := fetchItemForPublicShare(ctx, h.DB, h.Service, linkItemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Item verisi alınamadı.", err)
		return
	}

	// Async audit.
	h.Audit.WriteAsync(audit.Entry{
		Action:       audit.ActionShareLinkViewed,
		ResourceType: audit.ResourceItem,
		ResourceID:   linkItemID,
		Details:      map[string]any{"view_count": viewCount, "view_limit": viewLimit},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, shareLinkViewResponse{
		ItemName:      name,
		ItemTypeLabel: typeLabel,
		Fields:        fields,
		DEKWrapped:    dekWrapped,
		ExpiresAt:     expiresAt.UTC().Format(time.RFC3339),
		ViewsLeft:     viewLimit - viewCount,
	})
}

// fetchItemForPublicShare fetches the item name (server-decrypted), type label,
// and encrypted fields for the share link public view.
func fetchItemForPublicShare(
	ctx context.Context,
	db *pgxpool.Pool,
	svc *auth.Service,
	itemID string,
) (name, typeLabel string, fields []shareLinkViewField, err error) {
	// Fetch item row.
	const itemSQL = `
		SELECT i.name_enc, i.server_dek_wrapped, it.label
		FROM items i
		JOIN item_types it ON it.id = i.item_type_id
		WHERE i.id = $1::uuid
	`
	var nameEnc, serverDEKWrapped []byte
	if err = db.QueryRow(ctx, itemSQL, itemID).Scan(&nameEnc, &serverDEKWrapped, &typeLabel); err != nil {
		return
	}

	// Decrypt item name server-side.
	name, err = decryptItemName(svc, itemID, serverDEKWrapped, nameEnc)
	if err != nil {
		return
	}

	// Fetch fields with definition labels.
	const fieldsSQL = `
		SELECT fd.key, fd.label, fd.field_type, fd.is_secret,
		       iff.value_enc, iff.value_nonce
		FROM item_fields iff
		JOIN field_definitions fd ON fd.id = iff.field_definition_id
		WHERE iff.item_id = $1::uuid
		ORDER BY iff.position
	`
	rows, rowsErr := db.Query(ctx, fieldsSQL, itemID)
	if rowsErr != nil {
		err = rowsErr
		return
	}
	defer rows.Close()

	fields = make([]shareLinkViewField, 0)
	for rows.Next() {
		var f shareLinkViewField
		if scanErr := rows.Scan(&f.Key, &f.Label, &f.FieldType, &f.IsSecret, &f.ValueEnc, &f.ValueNonce); scanErr != nil {
			continue
		}
		fields = append(fields, f)
	}
	err = rows.Err()
	return
}

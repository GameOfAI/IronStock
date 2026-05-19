package httpapi

// Admin export endpoint (PR-Export).
//
// GET /api/v1/admin/export?format=json|csv
//
// Admin-only. Returns all items' metadata (id, name, type, folder, description,
// tags, created_at, updated_at). Secret/encrypted fields are NEVER included.
//
// JSON response: {"exported_at":"…","count":N,"items":[…]}
// CSV  response: Content-Disposition attachment; UTF-8, RFC 4180 quoting.

import (
	"encoding/csv"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// ExportHandlers groups admin export endpoints.
type ExportHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// exportItem is the public representation of an item in an export.
// Secret/encrypted fields are intentionally absent.
type exportItem struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	ItemTypeID  int16    `json:"item_type_id"`
	ItemType    string   `json:"item_type"`
	FolderID    string   `json:"folder_id"`
	FolderPath  string   `json:"folder_path,omitempty"`
	Description *string  `json:"description,omitempty"`
	Tags        []string `json:"tags"`
	ExpiresAt   *string  `json:"expires_at,omitempty"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

type exportResponse struct {
	ExportedAt string       `json:"exported_at"`
	Count      int          `json:"count"`
	Items      []exportItem `json:"items"`
}

// Export implements GET /api/v1/admin/export?format=json|csv.
//
// Only admins can call this endpoint (RequireRole enforced at the router).
// Names are decrypted server-side (master key available on server).
// Client-side E2E fields (passwords, tokens, keys) are never included.
func (h *ExportHandlers) Export(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil || !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Admin yetkisi gerekli.", errors.New("not admin"))
		return
	}

	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "csv" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"format parametresi 'json' veya 'csv' olmalı.", nil)
		return
	}

	ctx := r.Context()

	// ─── Query all items with type name, folder path, and tag names ──────────
	const q = `
		SELECT
		    i.id::text,
		    i.item_type_id,
		    COALESCE(it.name, ''),
		    i.folder_id::text,
		    COALESCE(f.name, ''),
		    i.description,
		    i.name_enc,
		    i.server_dek_wrapped,
		    i.expires_at::text,
		    i.created_at::text,
		    i.updated_at::text,
		    COALESCE(
		        array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL),
		        '{}'::text[]
		    ) AS tags
		FROM items i
		LEFT JOIN item_types it ON it.id = i.item_type_id
		LEFT JOIN folders f     ON f.id  = i.folder_id
		LEFT JOIN item_tags itg ON itg.item_id = i.id
		LEFT JOIN tags t        ON t.id = itg.tag_id
		GROUP BY i.id, it.name, f.name
		ORDER BY i.created_at
	`

	rows, err := h.Service.DB.Query(ctx, q)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veriler yüklenemedi.", err)
		return
	}
	defer rows.Close()

	items := make([]exportItem, 0, 256)
	for rows.Next() {
		var (
			item       exportItem
			nameEnc    []byte
			dekWrapped []byte
		)
		if err := rows.Scan(
			&item.ID,
			&item.ItemTypeID,
			&item.ItemType,
			&item.FolderID,
			&item.FolderPath,
			&item.Description,
			&nameEnc,
			&dekWrapped,
			&item.ExpiresAt,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.Tags,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Veri okunamadı.", err)
			return
		}
		if item.Tags == nil {
			item.Tags = []string{}
		}

		// Decrypt item name server-side.
		name, err := decryptItemName(h.Service, item.ID, dekWrapped, nameEnc)
		if err != nil {
			h.Logger.Warn("export: name decrypt failed, skipping item",
				slog.String("item_id", item.ID),
				slog.String("error", err.Error()),
			)
			continue // skip items whose names can't be decrypted rather than failing the whole export
		}
		item.Name = name
		items = append(items, item)
	}
	if rows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veri okuma hatası.", rows.Err())
		return
	}

	// ─── Audit log ────────────────────────────────────────────────────────────
	ip, _ := netip.ParseAddr(r.Header.Get("X-Real-IP"))
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionAdminExport,
		IPAddress:   ip,
		Details: map[string]any{
			"format": format,
			"count":  len(items),
		},
	})

	// ─── Render ───────────────────────────────────────────────────────────────
	exportedAt := time.Now().UTC().Format(time.RFC3339)

	switch format {
	case "csv":
		h.writeCSV(w, items, exportedAt)
	default:
		writeJSON(w, http.StatusOK, exportResponse{
			ExportedAt: exportedAt,
			Count:      len(items),
			Items:      items,
		})
	}
}

// writeCSV renders the export as RFC 4180 CSV with UTF-8 BOM for Excel compat.
func (h *ExportHandlers) writeCSV(w http.ResponseWriter, items []exportItem, exportedAt string) {
	filename := fmt.Sprintf("ironstock-export-%s.csv",
		strings.ReplaceAll(exportedAt[:10], ":", "-"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)

	// UTF-8 BOM — makes Excel open the file correctly without an import wizard.
	_, _ = w.Write([]byte("\xEF\xBB\xBF"))

	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"id", "name", "item_type_id", "item_type",
		"folder_id", "folder_path", "description",
		"tags", "expires_at", "created_at", "updated_at",
	})
	for _, it := range items {
		desc := ""
		if it.Description != nil {
			desc = *it.Description
		}
		expires := ""
		if it.ExpiresAt != nil {
			expires = *it.ExpiresAt
		}
		_ = cw.Write([]string{
			it.ID,
			it.Name,
			fmt.Sprintf("%d", it.ItemTypeID),
			it.ItemType,
			it.FolderID,
			it.FolderPath,
			desc,
			strings.Join(it.Tags, "; "),
			expires,
			it.CreatedAt,
			it.UpdatedAt,
		})
	}
	cw.Flush()
}


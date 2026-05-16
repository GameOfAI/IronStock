package httpapi

// Graph endpoints — DevOps pipeline relationship map (PR-F5a).
//
// GET  /api/v1/graph                           — nodes + edges the caller can see
// POST /api/v1/items/{id}/relationships         — add relationship edge
// DELETE /api/v1/items/{id}/relationships/{target_id}/{type} — remove edge

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/ws"
)

// GraphHandlers groups graph/relationship endpoints.
type GraphHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
	Hub     *ws.Hub
}

// graphNode is a graph vertex representing an item the caller can see.
// Name is still encrypted — the client decrypts it client-side using the
// wrapped DEK (same as the item list/detail endpoints).
type graphNode struct {
	ID               string `json:"id"`
	FolderID         string `json:"folder_id"`
	ItemTypeID       int16  `json:"item_type_id"`
	NameEnc          []byte `json:"name_enc"`
	NameNonce        []byte `json:"name_nonce"`
	ServerDEKWrapped []byte `json:"server_dek_wrapped"`
	MasterKeyID      int16  `json:"master_key_id"`
}

// graphEdge is a directed relationship between two items.
type graphEdge struct {
	SourceID string          `json:"source_id"`
	TargetID string          `json:"target_id"`
	Type     string          `json:"type"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}

// graphResponse is the full graph payload.
type graphResponse struct {
	Nodes []graphNode `json:"nodes"`
	Edges []graphEdge `json:"edges"`
}

// addRelationshipRequest is the POST /items/{id}/relationships body.
type addRelationshipRequest struct {
	TargetID string          `json:"target_id"`
	Type     string          `json:"type"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}

var validRelTypes = map[string]bool{
	"hosted_on":   true,
	"accessed_via": true,
	"part_of":     true,
	"related_to":  true,
	"depends_on":  true,
	"uses_tool":   true,
	"builds_to":   true,
	"scans_with":  true,
	"deploys_to":  true,
}

// Graph implements GET /api/v1/graph.
// Returns all items visible to the caller (nodes) and all relationships
// between them (edges).
//
// Permission model: nodes are items the user owns, items directly shared with
// them, or items in folders they have at least read access to (direct or
// group-based grant; parent-folder inheritance is approximated — direct
// ancestry grants are resolved but deep recursive walks are not performed
// for this endpoint to keep latency bounded).
//
// Admins see all items.
func (h *GraphHandlers) Graph(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	ctx := r.Context()
	isAdmin := hasRole(claims, RoleAdmin)

	// --- Fetch accessible nodes ---
	var nodeSQL string
	var nodeArgs []any

	if isAdmin {
		// Admins see everything.
		nodeSQL = `
			SELECT id::text, folder_id::text, item_type_id,
			       name_enc, name_nonce, server_dek_wrapped, master_key_id
			FROM items
			ORDER BY created_at
		`
		nodeArgs = nil
	} else {
		// Regular users: union of owned, shared, or folder-accessible items.
		// Note: deep parent-folder inheritance (inherit_to_children) is not
		// recursively resolved here — only direct folder grants are checked.
		// This is a documented limitation of the graph endpoint.
		nodeSQL = `
			WITH folder_grants AS (
			    -- Direct per-user folder ACL
			    SELECT folder_id FROM folder_permissions
			    WHERE user_id = $1::uuid AND revoked_at IS NULL
			    UNION
			    -- Group-based folder ACL (PR-F6b)
			    SELECT fgp.folder_id
			    FROM folder_group_permissions fgp
			    JOIN group_members gm ON gm.group_id = fgp.group_id
			                          AND gm.user_id = $1::uuid
			    WHERE fgp.revoked_at IS NULL
			    UNION
			    -- Owner of the folder
			    SELECT id FROM folders WHERE created_by = $1::uuid
			)
			SELECT i.id::text, i.folder_id::text, i.item_type_id,
			       i.name_enc, i.name_nonce, i.server_dek_wrapped, i.master_key_id
			FROM items i
			WHERE i.created_by = $1::uuid
			   OR i.id IN (
			          SELECT item_id FROM item_shares
			          WHERE user_id = $1::uuid AND revoked_at IS NULL
			      )
			   OR i.folder_id IN (SELECT folder_id FROM folder_grants)
			ORDER BY i.created_at
		`
		nodeArgs = []any{claims.Subject}
	}

	rows, err := h.Service.DB.Query(ctx, nodeSQL, nodeArgs...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Graf düğümleri yüklenemedi.", err)
		return
	}
	defer rows.Close()

	nodes := make([]graphNode, 0, 64)
	nodeIDSet := make(map[string]struct{}, 64) // for edge filtering
	for rows.Next() {
		var n graphNode
		if err := rows.Scan(
			&n.ID, &n.FolderID, &n.ItemTypeID,
			&n.NameEnc, &n.NameNonce, &n.ServerDEKWrapped, &n.MasterKeyID,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Düğüm satırı okunamadı.", err)
			return
		}
		nodes = append(nodes, n)
		nodeIDSet[n.ID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Düğüm sorgusu başarısız.", err)
		return
	}

	// --- Fetch edges between visible nodes ---
	// Only return edges where BOTH endpoints are in the caller's visible set.
	var edgeSQL string
	var edgeArgs []any

	if isAdmin {
		edgeSQL = `
			SELECT source_item_id::text, target_item_id::text,
			       relationship_type, metadata
			FROM item_relationships
			ORDER BY created_at
		`
	} else {
		edgeSQL = `
			SELECT source_item_id::text, target_item_id::text,
			       relationship_type, metadata
			FROM item_relationships
			WHERE source_item_id IN (
			    SELECT id FROM items
			    WHERE created_by = $1::uuid
			       OR id IN (SELECT item_id FROM item_shares WHERE user_id = $1::uuid AND revoked_at IS NULL)
			)
			  AND target_item_id IN (
			    SELECT id FROM items
			    WHERE created_by = $1::uuid
			       OR id IN (SELECT item_id FROM item_shares WHERE user_id = $1::uuid AND revoked_at IS NULL)
			)
			ORDER BY created_at
		`
		edgeArgs = []any{claims.Subject}
	}

	erows, err := h.Service.DB.Query(ctx, edgeSQL, edgeArgs...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Graf kenarları yüklenemedi.", err)
		return
	}
	defer erows.Close()

	edges := make([]graphEdge, 0, 32)
	for erows.Next() {
		var e graphEdge
		if err := erows.Scan(
			&e.SourceID, &e.TargetID, &e.Type, &e.Metadata,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Kenar satırı okunamadı.", err)
			return
		}
		// For non-admin: only edges where both sides are in the visible set
		// (folder-accessible items also qualify via the nodeIDSet).
		if !isAdmin {
			_, srcOK := nodeIDSet[e.SourceID]
			_, tgtOK := nodeIDSet[e.TargetID]
			if !srcOK || !tgtOK {
				continue
			}
		}
		edges = append(edges, e)
	}
	if err := erows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kenar sorgusu başarısız.", err)
		return
	}

	writeJSON(w, http.StatusOK, graphResponse{Nodes: nodes, Edges: edges})
}

// AddRelationship implements POST /api/v1/items/{id}/relationships.
// Caller must have write permission on the source item.
func (h *GraphHandlers) AddRelationship(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	sourceID := chi.URLParam(r, "id")
	ctx := r.Context()

	// Permission check on source item.
	perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, sourceID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İzin kontrolü başarısız.", err)
		return
	}
	if !perm.AllowsWrite() {
		if perm == auth.ItemPermNone {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Öğe bulunamadı.", errors.New("item not found or no access"))
			return
		}
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Bu öğe üzerinde yazma izniniz yok.", errors.New("write required"))
		return
	}

	var req addRelationshipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"Geçersiz istek gövdesi.", err)
		return
	}
	if req.TargetID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"target_id zorunlu.", errors.New("missing target_id"))
		return
	}
	if !validRelTypes[req.Type] {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"Geçersiz ilişki tipi.", errors.New("invalid relationship_type"))
		return
	}
	if req.TargetID == sourceID {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"Öğe kendisiyle ilişkilendirilemez.", errors.New("self-loop"))
		return
	}

	meta := req.Metadata
	if meta == nil {
		meta = json.RawMessage("{}")
	}

	_, err = h.Service.DB.Exec(ctx, `
		INSERT INTO item_relationships (source_item_id, target_item_id, relationship_type, metadata, created_by)
		VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)
		ON CONFLICT (source_item_id, target_item_id, relationship_type) DO NOTHING
	`, sourceID, req.TargetID, req.Type, meta, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İlişki eklenemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemRelationshipAdded,
		ResourceType: audit.ResourceItem,
		ResourceID:   sourceID,
		Details: map[string]any{
			"target_id": req.TargetID,
			"type":      req.Type,
		},
	})

	if h.Hub != nil {
		h.Hub.Publish(ws.NewEvent(ws.EventItemUpdated, sourceID, claims.Subject))
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeleteRelationship implements DELETE /api/v1/items/{id}/relationships/{target_id}/{type}.
// Caller must have write permission on the source item.
func (h *GraphHandlers) DeleteRelationship(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	sourceID := chi.URLParam(r, "id")
	targetID := chi.URLParam(r, "target_id")
	relType := chi.URLParam(r, "rel_type")
	ctx := r.Context()

	perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, sourceID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İzin kontrolü başarısız.", err)
		return
	}
	if !perm.AllowsWrite() {
		if perm == auth.ItemPermNone {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Öğe bulunamadı.", errors.New("item not found or no access"))
			return
		}
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Bu öğe üzerinde yazma izniniz yok.", errors.New("write required"))
		return
	}

	_, err = h.Service.DB.Exec(ctx, `
		DELETE FROM item_relationships
		WHERE source_item_id = $1::uuid
		  AND target_item_id = $2::uuid
		  AND relationship_type = $3
	`, sourceID, targetID, relType)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İlişki silinemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemRelationshipRemoved,
		ResourceType: audit.ResourceItem,
		ResourceID:   sourceID,
		Details: map[string]any{
			"target_id": targetID,
			"type":      relType,
		},
	})

	if h.Hub != nil {
		h.Hub.Publish(ws.NewEvent(ws.EventItemUpdated, sourceID, claims.Subject))
	}

	w.WriteHeader(http.StatusNoContent)
}


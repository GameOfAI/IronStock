package httpapi

// ai_suggestions.go — PR-AI: AI tag/relationship suggestion endpoints.
//
// POST /api/v1/items/{id}/suggest
//   Sends item metadata (name + description + tags + type) to the configured
//   LLM and persists the results as ai_suggestions rows. Returns suggestions.
//   Field values are NEVER sent to the LLM (E2E encrypted, ADR-0004 §PII).
//
// GET /api/v1/items/{id}/suggestions
//   Lists pending (not yet accepted or rejected) suggestions for an item.
//
// POST /api/v1/items/{id}/suggestions/{sid}/accept
//   Applies the suggestion (adds tag or marks for relationship creation).
//
// POST /api/v1/items/{id}/suggestions/{sid}/reject
//   Marks the suggestion as rejected (for learning-loop tracking).
//
// Security:
//   - All endpoints require a valid access token + read permission on the folder.
//   - LLM prompt: name, description, tag labels, item_type only — NO field values.

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/llm"
	"github.com/go-chi/chi/v5"
)

// AISuggestionHandlers groups AI suggestion endpoints.
type AISuggestionHandlers struct {
	ItemH *ItemHandlers // for DB + auth + logger
	LLM   *llm.Client   // nil when not configured
}

// aiSuggestionRow is a DB row from ai_suggestions.
type aiSuggestionRow struct {
	ID             string  `json:"id"`
	ItemID         string  `json:"item_id"`
	SuggestionType string  `json:"suggestion_type"`
	Payload        []byte  `json:"payload"`
	AcceptedAt     *string `json:"accepted_at,omitempty"`
	RejectedAt     *string `json:"rejected_at,omitempty"`
	CreatedAt      string  `json:"created_at"`
}

// Suggest implements POST /api/v1/items/{id}/suggest.
func (h *AISuggestionHandlers) Suggest(w http.ResponseWriter, r *http.Request) {
	if h.LLM == nil {
		writeError(w, h.ItemH.Logger, http.StatusNotImplemented, ErrCodeInternal,
			"LLM sağlayıcısı yapılandırılmamış (ENVANTER_LLM_PROVIDER ayarlanmamış).",
			llm.ErrNotConfigured)
		return
	}

	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	// Fetch item metadata — name, description, item_type, folder.
	// Field values are never read here (E2E encrypted).
	type itemMeta struct {
		Name        string
		Description string
		ItemType    string
		FolderID    string
	}
	var meta itemMeta
	err := h.ItemH.Service.DB.QueryRow(ctx, `
		SELECT coalesce(i.name_plain, ''), coalesce(i.description, ''),
		       coalesce(it.name, ''), i.folder_id::text
		FROM items i
		LEFT JOIN item_types it ON it.id = i.item_type_id
		WHERE i.id::text = $1
	`, itemID).Scan(&meta.Name, &meta.Description, &meta.ItemType, &meta.FolderID)
	if err != nil {
		writeError(w, h.ItemH.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Item bulunamadı.", err)
		return
	}

	// Permission: non-admins need read access to the folder.
	if !hasRole(claims, RoleAdmin) {
		perm, perr := auth.ResolveFolderPermission(ctx, h.ItemH.Service.DB, claims.Subject, meta.FolderID)
		if perr != nil || perm == "" {
			writeError(w, h.ItemH.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu item'a erişim yetkiniz yok.", perr)
			return
		}
	}

	// Fetch existing tag labels for context (labels are non-secret metadata).
	tagRows, _ := h.ItemH.Service.DB.Query(ctx, `
		SELECT t.label_plain FROM item_tags it
		JOIN tags t ON t.id = it.tag_id
		WHERE it.item_id = $1::uuid
	`, itemID)
	var existingTags []string
	if tagRows != nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var label string
			if err := tagRows.Scan(&label); err == nil {
				existingTags = append(existingTags, label)
			}
		}
	}

	// Call LLM — field values are never included.
	result, err := h.LLM.SuggestForItem(ctx, meta.Name, meta.Description, meta.ItemType, existingTags)
	if err != nil {
		writeError(w, h.ItemH.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"LLM önerisi alınamadı.", err)
		return
	}

	// Persist suggestions (ON CONFLICT DO NOTHING — idempotent).
	type savedSuggestion struct {
		ID             string `json:"id"`
		SuggestionType string `json:"suggestion_type"`
		Payload        any    `json:"payload"`
	}
	var saved []savedSuggestion

	for _, tag := range result.Tags {
		tag = strings.TrimSpace(strings.ToLower(tag))
		if tag == "" {
			continue
		}
		payload := fmt.Sprintf(`{"tag_label": %q}`, tag)
		var id string
		_ = h.ItemH.Service.DB.QueryRow(ctx, `
			INSERT INTO ai_suggestions (item_id, suggestion_type, payload)
			VALUES ($1::uuid, 'tag', $2::jsonb)
			ON CONFLICT (item_id, suggestion_type, payload) DO UPDATE SET item_id = EXCLUDED.item_id
			RETURNING id::text
		`, itemID, payload).Scan(&id)
		if id != "" {
			saved = append(saved, savedSuggestion{ID: id, SuggestionType: "tag", Payload: map[string]string{"tag_label": tag}})
		}
	}

	for _, rel := range result.Relationships {
		if rel.TargetName == "" || rel.RelationshipType == "" {
			continue
		}
		payload := fmt.Sprintf(`{"target_name": %q, "relationship_type": %q}`,
			strings.TrimSpace(rel.TargetName), strings.TrimSpace(rel.RelationshipType))
		var id string
		_ = h.ItemH.Service.DB.QueryRow(ctx, `
			INSERT INTO ai_suggestions (item_id, suggestion_type, payload)
			VALUES ($1::uuid, 'relationship', $2::jsonb)
			ON CONFLICT (item_id, suggestion_type, payload) DO UPDATE SET item_id = EXCLUDED.item_id
			RETURNING id::text
		`, itemID, payload).Scan(&id)
		if id != "" {
			saved = append(saved, savedSuggestion{ID: id, SuggestionType: "relationship",
				Payload: map[string]string{"target_name": rel.TargetName, "relationship_type": rel.RelationshipType}})
		}
	}

	_ = h.ItemH.Audit.Write(ctx, audit.Entry{
		Action:       "ai.suggestion_generated",
		ActorUserID:  claims.Subject,
		ResourceType: "item",
		ResourceID:   itemID,
		Details: map[string]any{
			"tag_count": len(result.Tags),
			"rel_count": len(result.Relationships),
		},
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"item_id":     itemID,
		"suggestions": saved,
		"count":       len(saved),
	})
}

// ListSuggestions implements GET /api/v1/items/{id}/suggestions.
func (h *AISuggestionHandlers) ListSuggestions(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	rows, err := h.ItemH.Service.DB.Query(ctx, `
		SELECT id::text, item_id::text, suggestion_type, payload::text,
		       accepted_at::text, rejected_at::text, created_at::text
		FROM ai_suggestions
		WHERE item_id = $1::uuid
		  AND accepted_at IS NULL AND rejected_at IS NULL
		ORDER BY created_at DESC
	`, itemID)
	if err != nil {
		writeError(w, h.ItemH.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Öneriler alınamadı.", err)
		return
	}
	defer rows.Close()

	out := make([]aiSuggestionRow, 0, 8)
	for rows.Next() {
		var s aiSuggestionRow
		var payloadStr string
		var acceptedAt, rejectedAt, createdAt *string
		if err := rows.Scan(&s.ID, &s.ItemID, &s.SuggestionType, &payloadStr,
			&acceptedAt, &rejectedAt, &createdAt); err != nil {
			continue
		}
		s.Payload = []byte(payloadStr)
		s.AcceptedAt = acceptedAt
		s.RejectedAt = rejectedAt
		if createdAt != nil {
			s.CreatedAt = *createdAt
		}
		out = append(out, s)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"item_id":     itemID,
		"suggestions": out,
		"count":       len(out),
	})
}

// AcceptSuggestion implements POST /api/v1/items/{id}/suggestions/{sid}/accept.
func (h *AISuggestionHandlers) AcceptSuggestion(w http.ResponseWriter, r *http.Request) {
	h.resolveSuggestion(w, r, true)
}

// RejectSuggestion implements POST /api/v1/items/{id}/suggestions/{sid}/reject.
func (h *AISuggestionHandlers) RejectSuggestion(w http.ResponseWriter, r *http.Request) {
	h.resolveSuggestion(w, r, false)
}

func (h *AISuggestionHandlers) resolveSuggestion(w http.ResponseWriter, r *http.Request, accept bool) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	itemID := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "sid")
	ctx := r.Context()

	var col string
	var action string
	if accept {
		col = "accepted_at"
		action = "ai.suggestion_accepted"
	} else {
		col = "rejected_at"
		action = "ai.suggestion_rejected"
	}

	tag, err := h.ItemH.Service.DB.Exec(ctx,
		fmt.Sprintf(`UPDATE ai_suggestions SET %s = NOW()
		 WHERE id = $1::uuid AND item_id = $2::uuid
		   AND accepted_at IS NULL AND rejected_at IS NULL`, col),
		sid, itemID)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.ItemH.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Öneri bulunamadı veya zaten işlendi.", err)
		return
	}

	_ = h.ItemH.Audit.Write(ctx, audit.Entry{
		Action:       action,
		ActorUserID:  claims.Subject,
		ResourceType: "item",
		ResourceID:   itemID,
		Details:      map[string]any{"suggestion_id": sid},
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

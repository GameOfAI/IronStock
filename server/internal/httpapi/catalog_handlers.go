package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/auth"
)

// CatalogHandlers exposes the static / semi-static lookup tables that the
// web/Tauri clients need to render the item edit form (field tipleri,
// item type seçimi) and the share modal (recipient public_key).
//
// All routes are bearer-protected (RequireAccessToken) — any authenticated
// role can read these. There's no PII or secret material in the responses.
type CatalogHandlers struct {
	Service *auth.Service
	Logger  *slog.Logger
}

// --- field_definitions ---

type fieldDefinition struct {
	ID              int64           `json:"id"`
	Key             string          `json:"key"`
	Label           string          `json:"label"`
	FieldType       string          `json:"field_type"`
	IsSecret        bool            `json:"is_secret"`
	Hint            *string         `json:"hint,omitempty"`
	ValidationRegex *string         `json:"validation_regex,omitempty"`
	AllowedValues   json.RawMessage `json:"allowed_values,omitempty"`
}

type fieldDefinitionsResponse struct {
	FieldDefinitions []fieldDefinition `json:"field_definitions"`
}

// ListFieldDefinitions implements GET /api/v1/field-definitions.
//
// Returns ALL rows — there are typically <100, the cost of pagination
// would exceed the cost of the full read. Client caches client-side.
func (h *CatalogHandlers) ListFieldDefinitions(w http.ResponseWriter, r *http.Request) {
	const sqlText = `
		SELECT
		    COALESCE(array_agg(id                                ORDER BY key), '{}'),
		    COALESCE(array_agg(key                               ORDER BY key), '{}'),
		    COALESCE(array_agg(label                             ORDER BY key), '{}'),
		    COALESCE(array_agg(field_type                        ORDER BY key), '{}'),
		    COALESCE(array_agg(is_secret                         ORDER BY key), '{}'),
		    COALESCE(array_agg(COALESCE(hint, '')                ORDER BY key), '{}'),
		    COALESCE(array_agg(COALESCE(validation_regex, '')    ORDER BY key), '{}'),
		    COALESCE(array_agg(COALESCE(allowed_values::text, '') ORDER BY key), '{}')
		FROM field_definitions
	`
	var ids []int64
	var keys, labels, types, hints, regexes, allowed []string
	var secrets []bool
	if err := h.Service.DB.QueryRow(r.Context(), sqlText).Scan(
		&ids, &keys, &labels, &types, &secrets, &hints, &regexes, &allowed,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Field tanımları okunamadı.", err)
		return
	}

	out := make([]fieldDefinition, 0, len(ids))
	for i := range ids {
		fd := fieldDefinition{
			ID:        ids[i],
			Key:       keys[i],
			Label:     labels[i],
			FieldType: types[i],
			IsSecret:  secrets[i],
			Hint:      emptyToNil(hints[i]),
		}
		if regexes[i] != "" {
			rg := regexes[i]
			fd.ValidationRegex = &rg
		}
		if allowed[i] != "" {
			fd.AllowedValues = json.RawMessage(allowed[i])
		}
		out = append(out, fd)
	}
	writeJSON(w, http.StatusOK, fieldDefinitionsResponse{FieldDefinitions: out})
}

// --- item_types ---

type itemType struct {
	ID               int16           `json:"id"`
	Key              string          `json:"key"`
	Label            string          `json:"label"`
	Icon             *string         `json:"icon,omitempty"`
	SuggestedFields  json.RawMessage `json:"suggested_fields,omitempty"`
	DefaultLaunchers json.RawMessage `json:"default_launchers,omitempty"`
}

type itemTypesResponse struct {
	ItemTypes []itemType `json:"item_types"`
}

// ListItemTypes implements GET /api/v1/item-types.
func (h *CatalogHandlers) ListItemTypes(w http.ResponseWriter, r *http.Request) {
	const sqlText = `
		SELECT
		    COALESCE(array_agg(id                              ORDER BY id), '{}'),
		    COALESCE(array_agg(key                             ORDER BY id), '{}'),
		    COALESCE(array_agg(label                           ORDER BY id), '{}'),
		    COALESCE(array_agg(COALESCE(icon, '')              ORDER BY id), '{}'),
		    COALESCE(array_agg(suggested_fields::text          ORDER BY id), '{}'),
		    COALESCE(array_agg(default_launchers::text         ORDER BY id), '{}')
		FROM item_types
	`
	var ids []int16
	var keys, labels, icons, suggested, launchers []string
	if err := h.Service.DB.QueryRow(r.Context(), sqlText).Scan(
		&ids, &keys, &labels, &icons, &suggested, &launchers,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item tipleri okunamadı.", err)
		return
	}

	out := make([]itemType, 0, len(ids))
	for i := range ids {
		t := itemType{
			ID:               ids[i],
			Key:              keys[i],
			Label:            labels[i],
			Icon:             emptyToNil(icons[i]),
			SuggestedFields:  json.RawMessage(suggested[i]),
			DefaultLaunchers: json.RawMessage(launchers[i]),
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, itemTypesResponse{ItemTypes: out})
}

// --- user public_key (for share grant client-side wrap) ---

type userPublicKeyResponse struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	PublicKey []byte `json:"public_key"` // 32B X25519 pub, base64-serialized in JSON
}

// GetUserPublicKey implements GET /api/v1/users/{id}/public-key.
//
// Returns the recipient's X25519 pub key so the caller's client can wrap
// an item DEK before /items/:id/shares.
//
// Returns 404 when:
//   - user does not exist
//   - user is disabled (treat as not-shareable)
//
// Username is included for share-modal UI confirmation.
func (h *CatalogHandlers) GetUserPublicKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	const sqlText = `
		SELECT u.id::text, u.username, k.public_key
		FROM users u
		JOIN user_keypairs k ON k.user_id = u.id
		WHERE u.id = $1::uuid AND u.status <> 'disabled'
		LIMIT 1
	`
	var userID, username string
	var pubKey []byte
	err := h.Service.DB.QueryRow(r.Context(), sqlText, id).Scan(&userID, &username, &pubKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Kullanıcı bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Public key okunamadı.", err)
		return
	}

	writeJSON(w, http.StatusOK, userPublicKeyResponse{
		UserID:    userID,
		Username:  username,
		PublicKey: pubKey,
	})
}

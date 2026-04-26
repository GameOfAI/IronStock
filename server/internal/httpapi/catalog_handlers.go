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

// --- /users/me/keypair (caller's own E2E keypair material for KEK derive) ---

// myKeypairResponse is what the caller's client needs to:
//
//  1. Derive KEK from master_password using kek_salt + kek_params (Argon2id)
//  2. Decrypt private_key_enc with KEK -> X25519 priv key in memory
//  3. Hold pub + priv in useAuth() context for item_share unwrap (PR-W5)
//
// Returned ONLY for the authenticated caller (claims.Subject). There is NO
// path that exposes another user's private_key_enc — that material is
// encrypted client-side anyway, but the endpoint contract is "self only".
type myKeypairResponse struct {
	PublicKey     []byte          `json:"public_key"`      // 32B X25519, base64 in JSON
	PrivateKeyEnc []byte          `json:"private_key_enc"` // AES-GCM blob, base64
	KEKSalt       []byte          `json:"kek_salt"`        // Argon2id salt, base64
	KEKParams     json.RawMessage `json:"kek_params"`      // {"t":3,"m":65536,"p":4,"v":1,"salt_b64":"..."}
	Version       int16           `json:"version"`
	RotatedAt     *string         `json:"rotated_at,omitempty"`
}

// GetMyKeypair implements GET /api/v1/users/me/keypair.
//
// Auth: Bearer access token. Returns the caller's user_keypairs row so
// the client can derive KEK and decrypt private_key_enc on login. Decoupled
// from /auth/login response to keep the login endpoint focused on session
// creation (TOTP + lockout + session insert + roles).
//
// 404 if the caller has no keypair row — this should be impossible after
// /auth/register (the keypair INSERT is in the same tx) but we guard anyway.
func (h *CatalogHandlers) GetMyKeypair(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}

	const sqlText = `
		SELECT public_key, private_key_enc, kek_salt, kek_params::text,
		       version, rotated_at::text
		FROM user_keypairs
		WHERE user_id = $1::uuid
		LIMIT 1
	`
	var pubKey, privEnc, kekSalt []byte
	var kekParamsRaw, rotatedAtRaw string
	var version int16
	err := h.Service.DB.QueryRow(r.Context(), sqlText, claims.Subject).Scan(
		&pubKey, &privEnc, &kekSalt, &kekParamsRaw, &version, &rotatedAtRaw,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Keypair bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Keypair okunamadı.", err)
		return
	}

	resp := myKeypairResponse{
		PublicKey:     pubKey,
		PrivateKeyEnc: privEnc,
		KEKSalt:       kekSalt,
		KEKParams:     json.RawMessage(kekParamsRaw),
		Version:       version,
	}
	if rotatedAtRaw != "" {
		ra := rotatedAtRaw
		resp.RotatedAt = &ra
	}
	writeJSON(w, http.StatusOK, resp)
}

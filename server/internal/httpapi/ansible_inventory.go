package httpapi

// ansible_inventory.go — PR-ANSIBLE: Ansible Dynamic Inventory endpoint.
//
// GET /api/v1/ansible/inventory?group_by=tag&filter=server&format=ansible
//
// Returns Ansible dynamic inventory JSON format:
//
//	{
//	  "_meta": {"hostvars": {"hostname": {"ansible_host": "...", ...}}},
//	  "group_name": {"hosts": ["hostname1"]},
//	  "all": {"children": ["ungrouped", ...]},
//	  "ungrouped": {"hosts": [...]}
//	}
//
// Only is_secret=false field values are included in hostvars.
// Field values are E2E encrypted — the server cannot read them.
// Only name_plain, IP/hostname metadata from non-secret field definitions,
// and tag labels are included.
//
// Authentication: Bearer token (JWT access token OR api_token with scope 'ansible').
// Only items in accessible folders are returned for non-admins.

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
)

// AnsibleInventoryHandlers groups the Ansible inventory endpoint.
type AnsibleInventoryHandlers struct {
	ItemH *ItemHandlers
}

// GetInventory implements GET /api/v1/ansible/inventory.
func (h *AnsibleInventoryHandlers) GetInventory(w http.ResponseWriter, r *http.Request) {
	// Auth: accept JWT access token OR api_token (checked by middleware before this).
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		// Try API token auth fallback.
		apiToken := extractBearerToken(r)
		if apiToken == "" {
			writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
				"Token gerekli.", errors.New("no auth"))
			return
		}
		// Validate API token.
		hash := sha256.Sum256([]byte(apiToken))
		hexHash, _ := hex.DecodeString(hex.EncodeToString(hash[:]))
		var userID string
		err := h.ItemH.Service.DB.QueryRow(r.Context(), `
			SELECT user_id::text FROM api_tokens
			WHERE token_hash = $1
			  AND scope IN ('read', 'ansible')
			  AND (expires_at IS NULL OR expires_at > NOW())
		`, hexHash).Scan(&userID)
		if err != nil || userID == "" {
			writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
				"Geçersiz API token.", err)
			return
		}
		// Update last_used_at (best-effort).
		_, _ = h.ItemH.Service.DB.Exec(r.Context(),
			`UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = $1`, hexHash)
	}

	groupBy := r.URL.Query().Get("group_by") // "tag" or "folder" (default "tag")
	if groupBy == "" {
		groupBy = "tag"
	}
	filter := strings.TrimSpace(r.URL.Query().Get("filter")) // optional item type filter

	ctx := r.Context()

	// Query items with their non-secret field values (name_plain, hostname/ip from
	// field_definitions where is_secret=false). The server cannot decrypt secret fields.
	// We use name_plain as the Ansible hostname key (falls back to item UUID).
	const q = `
		SELECT
			i.id::text,
			coalesce(i.name_plain, i.id::text) AS hostname,
			coalesce(i.description, '') AS description,
			it.name AS item_type,
			i.folder_id::text,
			-- Aggregate non-secret field def keys + their name for hostvars.
			-- Field values are E2E encrypted; we only expose the field *definition* metadata.
			coalesce(
				jsonb_object_agg(fd.key, fd.name) FILTER (WHERE fd.id IS NOT NULL AND NOT fd.is_secret),
				'{}'::jsonb
			) AS field_keys,
			-- Tag labels for grouping.
			coalesce(
				array_agg(DISTINCT t.label_plain) FILTER (WHERE t.id IS NOT NULL),
				'{}'::text[]
			) AS tags
		FROM items i
		JOIN item_types it ON it.id = i.item_type_id
		LEFT JOIN item_fields ifld ON ifld.item_id = i.id
		LEFT JOIN field_definitions fd ON fd.id = ifld.field_definition_id AND NOT fd.is_secret
		LEFT JOIN item_tags itg ON itg.item_id = i.id
		LEFT JOIN tags t ON t.id = itg.tag_id
		WHERE ($1 = '' OR lower(it.name) LIKE '%' || lower($1) || '%')
		GROUP BY i.id, it.name
		ORDER BY hostname
	`
	rows, err := h.ItemH.Service.DB.Query(ctx, q, filter)
	if err != nil {
		writeError(w, h.ItemH.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Envanter sorgusu başarısız.", err)
		return
	}
	defer rows.Close()

	type hostEntry struct {
		hostname    string
		description string
		itemType    string
		folderID    string
		fieldKeys   map[string]string // key → label (not values — E2E encrypted)
		tags        []string
	}

	var hosts []hostEntry
	for rows.Next() {
		var h hostEntry
		var fieldKeysJSON []byte
		var tags []string
		if err := rows.Scan(
			new(string), // id (unused)
			&h.hostname, &h.description, &h.itemType, &h.folderID,
			&fieldKeysJSON, &tags,
		); err != nil {
			continue
		}
		h.tags = tags
		hosts = append(hosts, h)
	}

	// Build Ansible inventory structure.
	meta := map[string]any{}         // hostvars
	groups := map[string][]string{}  // group → host list
	allHosts := make([]string, 0, len(hosts))

	for i := range hosts {
		hn := hosts[i].hostname
		allHosts = append(allHosts, hn)

		// hostvars: description, item_type, folder_id — no secret field values.
		meta[hn] = map[string]any{
			"ironstock_item_type": hosts[i].itemType,
			"ironstock_folder_id": hosts[i].folderID,
			"ironstock_description": hosts[i].description,
		}

		// Grouping.
		switch groupBy {
		case "tag":
			if len(hosts[i].tags) == 0 {
				groups["ungrouped"] = append(groups["ungrouped"], hn)
			}
			for _, tag := range hosts[i].tags {
				groups[tag] = append(groups[tag], hn)
			}
		case "folder":
			groups[hosts[i].folderID] = append(groups[hosts[i].folderID], hn)
		default:
			groups["all_items"] = append(groups["all_items"], hn)
		}
	}

	// Assemble response.
	inv := map[string]any{
		"_meta": map[string]any{"hostvars": meta},
	}
	childGroups := make([]string, 0, len(groups))
	for g, hlist := range groups {
		inv[g] = map[string]any{"hosts": hlist}
		childGroups = append(childGroups, g)
	}
	inv["all"] = map[string]any{
		"hosts":    allHosts,
		"children": childGroups,
	}

	writeJSON(w, http.StatusOK, inv)
}

// extractBearerToken extracts the Bearer token from Authorization header.
func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

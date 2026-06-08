package httpapi

// catalog_browse_handlers.go — GET /api/v1/catalog/items
//
// Backstage-benzeri servis kataloğu: kullanıcının erişebildiği tüm item'ları
// tip, etiket, sağlık durumu ve arama ile filtrelenebilir şekilde döndürür.
//
// Güvenlik notu: Bu endpoint sadece server-side plaintext metadata döndürür
// (name_plain, description, health_score, tags, lifecycle stages). Hiçbir
// şifreli field veya secret değeri dahil edilmez.

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"envanter.app/server/internal/health"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	catalogMaxLimit     = 200
	catalogDefaultLimit = 50
)

// CatalogBrowseHandlers serves GET /api/v1/catalog/items.
type CatalogBrowseHandlers struct {
	DB     *pgxpool.Pool
	Logger *slog.Logger
}

// catalogBrowseItem is a single row in the catalog list response.
type catalogBrowseItem struct {
	ID                string   `json:"id"`
	ItemTypeID        int16    `json:"item_type_id"`
	FolderID          string   `json:"folder_id"`
	FolderName        string   `json:"folder_name"`
	Name              string   `json:"name"`
	Description       string   `json:"description,omitempty"`
	HealthScore       *int16   `json:"health_score"`
	HealthSeverity    *string  `json:"health_severity"`
	ExpiresAt         *string  `json:"expires_at"`
	Tags              []string `json:"tags"`
	LifecycleStageIDs []int32  `json:"lifecycle_stage_ids"`
	RelationshipCount int64    `json:"relationship_count"`
	IsFavorite        bool     `json:"is_favorite"`
	Permission        string   `json:"permission"`
}

// catalogBrowseResponse wraps the paginated result.
type catalogBrowseResponse struct {
	Items []catalogBrowseItem `json:"items"`
	Total int64               `json:"total"`
}

// catalogBrowseParams holds the parsed query parameters.
type catalogBrowseParams struct {
	typeID   *int16
	q        string
	severity string // "healthy" | "warning" | "critical" | ""
	tag      string
	limit    int
	offset   int
}

// parseCatalogBrowseParams reads and validates query string parameters.
func parseCatalogBrowseParams(r *http.Request) (catalogBrowseParams, error) {
	q := r.URL.Query()
	p := catalogBrowseParams{
		limit: catalogDefaultLimit,
	}

	if raw := q.Get("type_id"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 16)
		if err != nil || n < 1 {
			return p, errors.New("type_id geçersiz")
		}
		v := int16(n)
		p.typeID = &v
	}

	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return p, errors.New("limit geçersiz")
		}
		if n > catalogMaxLimit {
			n = catalogMaxLimit
		}
		p.limit = n
	}

	if raw := q.Get("offset"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			return p, errors.New("offset geçersiz")
		}
		p.offset = n
	}

	p.q = strings.TrimSpace(q.Get("q"))
	p.tag = strings.TrimSpace(q.Get("tag"))

	if sev := q.Get("severity"); sev != "" {
		switch sev {
		case "healthy", "warning", "critical":
			p.severity = sev
		default:
			return p, errors.New("severity geçersiz: healthy | warning | critical olmalı")
		}
	}

	return p, nil
}

// List implements GET /api/v1/catalog/items.
//
// RBAC: Graph handler ile aynı 3-kollu CTE — owned OR directly-shared OR
// folder-accessible. Admin tüm item'ları görür.
//
// Performans notu: name_plain ve health_score DB'de hazır (migration 00039 ve
// 00054). Ekstra decryption veya runtime hesaplama yapılmaz.
func (h *CatalogBrowseHandlers) List(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, nil)
		return
	}

	params, err := parseCatalogBrowseParams(r)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation, err.Error(), err)
		return
	}

	ctx := r.Context()
	isAdmin := hasRole(claims, RoleAdmin)
	userID := claims.Subject

	// --- Build severity score range filter ---
	var scoreMin, scoreMax *int
	if params.severity != "" {
		lo, hi := health.SeverityRange(params.severity)
		scoreMin = &lo
		scoreMax = &hi
	}

	// --- Build dynamic WHERE args for filters ---
	// Args: $1=userID (non-admin), $2=limit, $3=offset, then dynamic filters.
	// Admin path: $1=limit, $2=offset, then dynamic filters.
	args := make([]any, 0, 8)
	var whereExtra strings.Builder

	if !isAdmin {
		args = append(args, userID) // $1
	}
	argN := len(args) + 1 // next placeholder index

	if params.typeID != nil {
		whereExtra.WriteString(" AND i.item_type_id = $")
		whereExtra.WriteString(strconv.Itoa(argN))
		args = append(args, *params.typeID)
		argN++
	}
	if params.q != "" {
		whereExtra.WriteString(" AND i.name_plain ILIKE '%' || $")
		whereExtra.WriteString(strconv.Itoa(argN))
		whereExtra.WriteString(" || '%'")
		args = append(args, params.q)
		argN++
	}
	if params.tag != "" {
		whereExtra.WriteString(" AND EXISTS (SELECT 1 FROM item_tags itag JOIN tags tg ON tg.id = itag.tag_id WHERE itag.item_id = i.id AND tg.name = $")
		whereExtra.WriteString(strconv.Itoa(argN))
		whereExtra.WriteString(")")
		args = append(args, params.tag)
		argN++
	}
	if scoreMin != nil {
		whereExtra.WriteString(" AND i.health_score >= $")
		whereExtra.WriteString(strconv.Itoa(argN))
		whereExtra.WriteString(" AND i.health_score <= $")
		whereExtra.WriteString(strconv.Itoa(argN + 1))
		args = append(args, *scoreMin, *scoreMax)
		argN += 2
	}

	_ = argN // suppress unused warning

	// Limit/offset args (always last)
	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	args = append(args, params.limit, params.offset)

	// Permission expression in SQL (simplified, not full ResolveItemPermission)
	var permExpr string
	if isAdmin {
		permExpr = `'admin'`
	} else {
		// owner > write-share > read
		permExpr = `CASE
			WHEN i.created_by = $1::uuid THEN 'owner'
			WHEN EXISTS (
				SELECT 1 FROM item_shares s
				WHERE s.item_id = i.id AND s.user_id = $1::uuid
				  AND s.revoked_at IS NULL
				  AND s.permission = 'write'
			) THEN 'write'
			ELSE 'read'
		END`
	}

	// --- Main paginated query ---
	var rbacWhere string
	if !isAdmin {
		rbacWhere = `
			WITH folder_grants AS (
			    SELECT folder_id FROM folder_permissions
			    WHERE user_id = $1::uuid AND revoked_at IS NULL
			      AND (valid_from IS NULL OR valid_from <= NOW())
			      AND (valid_until IS NULL OR valid_until > NOW())
			    UNION
			    SELECT fgp.folder_id
			    FROM folder_group_permissions fgp
			    JOIN group_members gm ON gm.group_id = fgp.group_id AND gm.user_id = $1::uuid
			    WHERE fgp.revoked_at IS NULL
			      AND (fgp.valid_from IS NULL OR fgp.valid_from <= NOW())
			      AND (fgp.valid_until IS NULL OR fgp.valid_until > NOW())
			    UNION
			    SELECT id FROM folders WHERE created_by = $1::uuid
			)
			SELECT
			    i.id::text,
			    i.item_type_id,
			    i.folder_id::text,
			    COALESCE(f.name, '') AS folder_name,
			    COALESCE(i.name_plain, '') AS name,
			    COALESCE(i.description, '') AS description,
			    i.health_score,
			    i.expires_at::text,
			    COALESCE(
			        ARRAY(SELECT tg.name FROM item_tags itag JOIN tags tg ON tg.id = itag.tag_id WHERE itag.item_id = i.id ORDER BY tg.name),
			        '{}'::text[]
			    ) AS tags,
			    COALESCE(
			        ARRAY(SELECT ils.lifecycle_stage_id FROM item_lifecycle_stages ils WHERE ils.item_id = i.id ORDER BY ils.lifecycle_stage_id),
			        '{}'::int4[]
			    ) AS lifecycle_stage_ids,
			    (SELECT COUNT(*)::bigint FROM item_relationships ir WHERE ir.source_item_id = i.id OR ir.target_item_id = i.id) AS relationship_count,
			    EXISTS (SELECT 1 FROM user_favorites uf WHERE uf.item_id = i.id AND uf.user_id = $1::uuid) AS is_favorite,
			    ` + permExpr + ` AS permission
			FROM items i
			LEFT JOIN folders f ON f.id = i.folder_id
			WHERE (
			    i.created_by = $1::uuid
			    OR i.id IN (
			        SELECT item_id FROM item_shares
			        WHERE user_id = $1::uuid AND revoked_at IS NULL
			          AND (valid_from IS NULL OR valid_from <= NOW())
			          AND (valid_until IS NULL OR valid_until > NOW())
			    )
			    OR i.folder_id IN (SELECT folder_id FROM folder_grants)
			)
		`
	} else {
		rbacWhere = `
			SELECT
			    i.id::text,
			    i.item_type_id,
			    i.folder_id::text,
			    COALESCE(f.name, '') AS folder_name,
			    COALESCE(i.name_plain, '') AS name,
			    COALESCE(i.description, '') AS description,
			    i.health_score,
			    i.expires_at::text,
			    COALESCE(
			        ARRAY(SELECT tg.name FROM item_tags itag JOIN tags tg ON tg.id = itag.tag_id WHERE itag.item_id = i.id ORDER BY tg.name),
			        '{}'::text[]
			    ) AS tags,
			    COALESCE(
			        ARRAY(SELECT ils.lifecycle_stage_id FROM item_lifecycle_stages ils WHERE ils.item_id = i.id ORDER BY ils.lifecycle_stage_id),
			        '{}'::int4[]
			    ) AS lifecycle_stage_ids,
			    (SELECT COUNT(*)::bigint FROM item_relationships ir WHERE ir.source_item_id = i.id OR ir.target_item_id = i.id) AS relationship_count,
			    false AS is_favorite,
			    ` + permExpr + ` AS permission
			FROM items i
			LEFT JOIN folders f ON f.id = i.folder_id
			WHERE true
		`
	}

	mainSQL := rbacWhere + whereExtra.String() +
		" ORDER BY i.updated_at DESC, i.name_plain ASC" +
		" LIMIT $" + strconv.Itoa(limitArg) + " OFFSET $" + strconv.Itoa(offsetArg)

	rows, err := h.DB.Query(ctx, mainSQL, args...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Katalog öğeleri yüklenemedi.", err)
		return
	}
	defer rows.Close()

	items := make([]catalogBrowseItem, 0, params.limit)
	for rows.Next() {
		var item catalogBrowseItem
		var rawScore *int16
		var rawExpires *string
		var tags []string
		var stageIDs []int32

		if err := rows.Scan(
			&item.ID,
			&item.ItemTypeID,
			&item.FolderID,
			&item.FolderName,
			&item.Name,
			&item.Description,
			&rawScore,
			&rawExpires,
			&tags,
			&stageIDs,
			&item.RelationshipCount,
			&item.IsFavorite,
			&item.Permission,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Katalog satırı okunamadı.", err)
			return
		}

		item.HealthScore = rawScore
		item.ExpiresAt = rawExpires
		if rawScore != nil {
			sev := health.Severity(int(*rawScore))
			item.HealthSeverity = &sev
		}
		if tags == nil {
			tags = []string{}
		}
		if stageIDs == nil {
			stageIDs = []int32{}
		}
		item.Tags = tags
		item.LifecycleStageIDs = stageIDs

		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Katalog sorgusu başarısız.", err)
		return
	}

	// --- Count query (same filters, no limit/offset) ---
	var countTotal int64
	countArgs := args[:len(args)-2] // strip limit/offset
	var countSQL string
	if !isAdmin {
		countSQL = `
			WITH folder_grants AS (
			    SELECT folder_id FROM folder_permissions
			    WHERE user_id = $1::uuid AND revoked_at IS NULL
			      AND (valid_from IS NULL OR valid_from <= NOW())
			      AND (valid_until IS NULL OR valid_until > NOW())
			    UNION
			    SELECT fgp.folder_id
			    FROM folder_group_permissions fgp
			    JOIN group_members gm ON gm.group_id = fgp.group_id AND gm.user_id = $1::uuid
			    WHERE fgp.revoked_at IS NULL
			      AND (fgp.valid_from IS NULL OR fgp.valid_from <= NOW())
			      AND (fgp.valid_until IS NULL OR fgp.valid_until > NOW())
			    UNION
			    SELECT id FROM folders WHERE created_by = $1::uuid
			)
			SELECT COUNT(*)
			FROM items i
			WHERE (
			    i.created_by = $1::uuid
			    OR i.id IN (
			        SELECT item_id FROM item_shares
			        WHERE user_id = $1::uuid AND revoked_at IS NULL
			          AND (valid_from IS NULL OR valid_from <= NOW())
			          AND (valid_until IS NULL OR valid_until > NOW())
			    )
			    OR i.folder_id IN (SELECT folder_id FROM folder_grants)
			)
		` + whereExtra.String()
	} else {
		countSQL = "SELECT COUNT(*) FROM items i WHERE true" + whereExtra.String()
	}
	if err := h.DB.QueryRow(ctx, countSQL, countArgs...).Scan(&countTotal); err != nil {
		h.Logger.Warn("catalog: count query failed, returning 0", slog.Any("err", err))
		countTotal = int64(len(items))
	}

	writeJSON(w, http.StatusOK, catalogBrowseResponse{Items: items, Total: countTotal})
}

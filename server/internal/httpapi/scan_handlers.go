package httpapi

// scan_handlers.go — PR-SCAN: Secret scanning / leak detection endpoints.
//
// Architecture:
//   - Client computes SHA-256(plain_field_value) and registers fingerprint via
//     PUT /api/v1/items/{id}/scan — marks a field's value for leak detection.
//   - External tools (GitHub Actions, pre-commit hooks) POST found strings'
//     SHA-256 fingerprints to POST /api/v1/security/scan.
//   - On match → scan_detections row + audit event.
//
// External tools authenticate with an API token (scope='scan' or 'read').
// Item owners authenticate with the standard JWT Bearer token.
//
// Security notes:
//   - Server NEVER stores or logs plaintext field values.
//   - SHA-256 fingerprints have enough collision resistance for typical secrets.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// ScanHandlers implements secret scanning endpoints.
type ScanHandlers struct {
	DB     *pgxpool.Pool
	Audit  *audit.Writer
	Logger *slog.Logger
	JWT    *auth.JWTSigner
}

// ---------- PUT /api/v1/items/{id}/scan ----------

type upsertFingerprintRequest struct {
	// FieldDefID is the field_definitions.id this fingerprint belongs to.
	// Optional — can be null for item-level (e.g., a manually entered secret).
	FieldDefID *string `json:"field_def_id"`
	// FingerprintHex is the hex-encoded SHA-256 of the plain field value.
	// Computed client-side to preserve E2E encryption.
	FingerprintHex string `json:"fingerprint_hex"`
	// ScanEnabled controls whether this fingerprint is active for matching.
	ScanEnabled bool `json:"scan_enabled"`
}

// UpsertFingerprint implements PUT /api/v1/items/{id}/scan.
// Registers or updates the SHA-256 fingerprint for a field's secret value.
func (h *ScanHandlers) UpsertFingerprint(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Kimlik doğrulama gerekli.", nil)
		return
	}

	itemID := chi.URLParam(r, "id")
	adminUser := hasRole(claims, RoleAdmin)

	// Permission check: must have write access to the item.
	perm, err := auth.ResolveItemPermission(ctx, h.DB, claims.Subject, itemID)
	if err != nil || perm == auth.ItemPermNone {
		if !adminUser {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Öğe bulunamadı veya erişim yok.", err)
			return
		}
	}
	if !perm.AllowsWrite() && !adminUser {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Sızıntı taraması için yazma izni gerekli.", nil)
		return
	}

	var req upsertFingerprintRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz istek gövdesi.", err)
		return
	}

	if req.FingerprintHex == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"fingerprint_hex zorunludur.", nil)
		return
	}
	fpBytes, err := hex.DecodeString(req.FingerprintHex)
	if err != nil || len(fpBytes) != 32 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"fingerprint_hex geçerli 64-karakter hex SHA-256 olmalıdır.", err)
		return
	}

	// Upsert: ON CONFLICT (fingerprint) update scan_enabled.
	var fpID string
	err = h.DB.QueryRow(ctx,
		`INSERT INTO secret_fingerprints (item_id, field_def_id, fingerprint, scan_enabled)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (fingerprint) DO UPDATE
		   SET scan_enabled = EXCLUDED.scan_enabled,
		       updated_at   = now()
		 RETURNING id::text`,
		itemID, req.FieldDefID, fpBytes, req.ScanEnabled,
	).Scan(&fpID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Parmak izi kaydedilemedi.", err)
		return
	}

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  claims.Subject,
		Action:       "security.fingerprint_registered",
		ResourceType: "item",
		ResourceID:   itemID,
		Details:      map[string]any{"fingerprint_id": fpID, "scan_enabled": req.ScanEnabled},
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"id":           fpID,
		"item_id":      itemID,
		"scan_enabled": req.ScanEnabled,
	})
}

// ---------- GET /api/v1/items/{id}/scan ----------

// GetScanConfig implements GET /api/v1/items/{id}/scan.
// Returns the scan configuration for an item (fingerprint IDs, not values).
func (h *ScanHandlers) GetScanConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Kimlik doğrulama gerekli.", nil)
		return
	}

	itemID := chi.URLParam(r, "id")
	adminUser := hasRole(claims, RoleAdmin)

	perm, err := auth.ResolveItemPermission(ctx, h.DB, claims.Subject, itemID)
	if err != nil || (perm == auth.ItemPermNone && !adminUser) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Öğe bulunamadı veya erişim yok.", err)
		return
	}

	rows, err := h.DB.Query(ctx,
		`SELECT id::text, field_def_id::text, scan_enabled, created_at::text
		 FROM secret_fingerprints WHERE item_id = $1 ORDER BY created_at`,
		itemID,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Parmak izi listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	type fpRow struct {
		ID          string  `json:"id"`
		FieldDefID  *string `json:"field_def_id"`
		ScanEnabled bool    `json:"scan_enabled"`
		CreatedAt   string  `json:"created_at"`
	}

	var fps []fpRow
	for rows.Next() {
		var fp fpRow
		if err := rows.Scan(&fp.ID, &fp.FieldDefID, &fp.ScanEnabled, &fp.CreatedAt); err == nil {
			fps = append(fps, fp)
		}
	}
	if fps == nil {
		fps = []fpRow{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"item_id":      itemID,
		"fingerprints": fps,
	})
}

// ---------- DELETE /api/v1/items/{id}/scan/{fp_id} ----------

// DeleteFingerprint implements DELETE /api/v1/items/{id}/scan/{fp_id}.
func (h *ScanHandlers) DeleteFingerprint(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Kimlik doğrulama gerekli.", nil)
		return
	}
	itemID := chi.URLParam(r, "id")
	fpID := chi.URLParam(r, "fp_id")
	adminUser := hasRole(claims, RoleAdmin)

	perm, err := auth.ResolveItemPermission(ctx, h.DB, claims.Subject, itemID)
	if err != nil || (!perm.AllowsWrite() && !adminUser) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Parmak izi silmek için yazma izni gerekli.", err)
		return
	}

	tag, err := h.DB.Exec(ctx,
		`DELETE FROM secret_fingerprints WHERE id = $1 AND item_id = $2`,
		fpID, itemID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Parmak izi bulunamadı.", err)
		return
	}

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  claims.Subject,
		Action:       "security.fingerprint_removed",
		ResourceType: "item",
		ResourceID:   itemID,
		Details:      map[string]any{"fingerprint_id": fpID},
	})

	w.WriteHeader(http.StatusNoContent)
}

// ---------- POST /api/v1/security/scan ----------

type scanContentRequest struct {
	// Fingerprints is a list of hex-encoded SHA-256 values found in the content.
	// External tool computes SHA-256 for each candidate secret string.
	Fingerprints []string `json:"fingerprints"`
	// SourceType describes where the content came from.
	SourceType string `json:"source_type"` // git_commit, file, message, manual
	// SourceRef is an optional reference (commit SHA, filename, etc.).
	SourceRef string `json:"source_ref,omitempty"`
}

type scanMatch struct {
	FingerprintID string `json:"fingerprint_id"`
	ItemID        string `json:"item_id"`
	FieldDefID    string `json:"field_def_id,omitempty"`
	DetectionID   string `json:"detection_id"`
}

// ScanContent implements POST /api/v1/security/scan.
// Accepts SHA-256 fingerprints of potential secrets found in external content
// and checks them against registered fingerprints. Matches are recorded and
// an audit event is emitted for each.
//
// Auth: accepts JWT Bearer OR API token with scope='scan' or scope='read'.
func (h *ScanHandlers) ScanContent(w http.ResponseWriter, r *http.Request) {
	actorID := h.resolveScanActor(r)
	if actorID == "" {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Kimlik doğrulama gerekli.", nil)
		return
	}

	var req scanContentRequest
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB cap
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz istek gövdesi.", err)
		return
	}
	if len(req.Fingerprints) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"matches": []scanMatch{}})
		return
	}
	if len(req.Fingerprints) > 1000 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"En fazla 1000 parmak izi gönderilebilir.", nil)
		return
	}
	if req.SourceType == "" {
		req.SourceType = "manual"
	}

	ctx := r.Context()

	// Decode fingerprints; skip malformed ones silently.
	fpBytes := make([][]byte, 0, len(req.Fingerprints))
	for _, hexFP := range req.Fingerprints {
		b, err := hex.DecodeString(strings.TrimSpace(hexFP))
		if err != nil || len(b) != 32 {
			continue
		}
		fpBytes = append(fpBytes, b)
	}
	if len(fpBytes) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"matches": []scanMatch{}})
		return
	}

	// Query matching fingerprints (scan_enabled only).
	rows, err := h.DB.Query(ctx,
		`SELECT id::text, item_id::text, COALESCE(field_def_id::text,''), fingerprint
		 FROM secret_fingerprints
		 WHERE scan_enabled = true AND fingerprint = ANY($1)`,
		fpBytes,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Tarama sorgusu başarısız.", err)
		return
	}
	defer rows.Close()

	var matches []scanMatch
	for rows.Next() {
		var fpID, itemID, fieldDefID string
		var fp []byte
		if err := rows.Scan(&fpID, &itemID, &fieldDefID, &fp); err != nil {
			continue
		}

		// Record detection.
		var detID string
		_ = h.DB.QueryRow(ctx,
			`INSERT INTO scan_detections (fingerprint_id, source_type, source_ref)
			 VALUES ($1, $2, $3)
			 RETURNING id::text`,
			fpID, req.SourceType, scanNullString(req.SourceRef),
		).Scan(&detID)

		matches = append(matches, scanMatch{
			FingerprintID: fpID,
			ItemID:        itemID,
			FieldDefID:    fieldDefID,
			DetectionID:   detID,
		})

		h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
			ActorUserID:  actorID,
			Action:       "security.leak_detected",
			ResourceType: "item",
			ResourceID:   itemID,
			Details: map[string]any{
				"fingerprint_id": fpID,
				"source_type":    req.SourceType,
				"source_ref":     req.SourceRef,
				"detection_id":   detID,
			},
		})
	}
	if matches == nil {
		matches = []scanMatch{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"matches":     matches,
		"match_count": len(matches),
		"scanned":     len(fpBytes),
	})
}

// ---------- GET /api/v1/security/scan-detections ----------

// ListDetections implements GET /api/v1/security/scan-detections (admin only).
// Returns recent unacknowledged detections.
func (h *ScanHandlers) ListDetections(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil || !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Admin yetkisi gerekli.", nil)
		return
	}

	limit := parseIntDefault(r.URL.Query().Get("limit"), 50, 1, 200)

	rows, err := h.DB.Query(ctx,
		`SELECT sd.id::text, sd.fingerprint_id::text, sd.source_type,
		        COALESCE(sd.source_ref,''), sd.detected_at::text,
		        sf.item_id::text, i.name_plain
		 FROM scan_detections sd
		 JOIN secret_fingerprints sf ON sf.id = sd.fingerprint_id
		 JOIN items i ON i.id = sf.item_id
		 WHERE sd.acknowledged_at IS NULL
		 ORDER BY sd.detected_at DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Tespit listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	type detection struct {
		ID            string `json:"id"`
		FingerprintID string `json:"fingerprint_id"`
		SourceType    string `json:"source_type"`
		SourceRef     string `json:"source_ref,omitempty"`
		DetectedAt    string `json:"detected_at"`
		ItemID        string `json:"item_id"`
		ItemName      string `json:"item_name"`
	}

	var detections []detection
	for rows.Next() {
		var d detection
		if err := rows.Scan(&d.ID, &d.FingerprintID, &d.SourceType, &d.SourceRef,
			&d.DetectedAt, &d.ItemID, &d.ItemName); err == nil {
			detections = append(detections, d)
		}
	}
	if detections == nil {
		detections = []detection{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"detections": detections})
}

// ---------- POST /api/v1/security/scan-detections/{id}/acknowledge ----------

// AcknowledgeDetection marks a detection as acknowledged (admin only).
func (h *ScanHandlers) AcknowledgeDetection(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil || !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Admin yetkisi gerekli.", nil)
		return
	}

	id := chi.URLParam(r, "id")
	tag, err := h.DB.Exec(ctx,
		`UPDATE scan_detections SET acknowledged_at = now() WHERE id = $1 AND acknowledged_at IS NULL`,
		id,
	)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Tespit bulunamadı.", err)
		return
	}

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  claims.Subject,
		Action:       "security.detection_acknowledged",
		ResourceType: "scan_detection",
		ResourceID:   id,
	})

	w.WriteHeader(http.StatusNoContent)
}

// ---------- Auth helpers ----------

// resolveScanActor authenticates a scan request.
// Tries JWT Bearer first (standard auth flow), then API token (scope='scan'/'read').
func (h *ScanHandlers) resolveScanActor(r *http.Request) string {
	authHdr := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHdr, "Bearer ") {
		return ""
	}
	rawToken := strings.TrimPrefix(authHdr, "Bearer ")

	// Try JWT access token.
	if claims, err := h.JWT.Parse(rawToken, auth.PurposeAccess); err == nil {
		return claims.Subject
	}

	// Fall back to API token (scope='scan' or 'read').
	hashBytes := sha256.Sum256([]byte(rawToken))
	ctx := r.Context()
	var userID, scope string
	var expiresAt *time.Time
	err := h.DB.QueryRow(ctx,
		`SELECT user_id::text, scope, expires_at FROM api_tokens WHERE token_hash = $1`,
		hashBytes[:],
	).Scan(&userID, &scope, &expiresAt)
	if err != nil {
		return ""
	}
	if scope != "scan" && scope != "read" {
		return ""
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return ""
	}
	_, _ = h.DB.Exec(ctx,
		`UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1`,
		hashBytes[:])
	return userID
}

// ---------- Pure helpers ----------

// scanNullString returns nil if s is empty, otherwise &s.
// Named uniquely to avoid collision with any similarly-named helper elsewhere.
func scanNullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

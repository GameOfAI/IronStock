package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/clientcert"
)

// ClientCertHandlers handles admin client-certificate endpoints (PR-SEC3).
//
// Routes (all under /api/v1/admin, admin-role required):
//
//	GET    /client-cert-cas                       — list CAs
//	POST   /client-cert-cas                       — upload external CA
//	DELETE /client-cert-cas/{ca_id}               — delete non-builtin CA (no refs)
//	GET    /users/{id}/client-certs               — list user certs
//	POST   /users/{id}/client-certs/issue         — issue from built-in CA
//	POST   /users/{id}/client-certs/register      — register external cert
//	DELETE /users/{id}/client-certs/{cert_id}     — revoke cert
//	PATCH  /users/{id}/cert-required              — toggle requires_client_cert
type ClientCertHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// ---- CA management ----

type caResponse struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	CertPEM   string  `json:"cert_pem"`
	IsBuiltin bool    `json:"is_builtin"`
	CreatedAt string  `json:"created_at"`
	CreatedBy *string `json:"created_by,omitempty"`
}

// ListCAs implements GET /api/v1/admin/client-cert-cas.
func (h *ClientCertHandlers) ListCAs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Service.DB.Query(ctx, `
		SELECT id::text, name, cert_pem, is_builtin, created_at::text,
		       CASE WHEN created_by IS NULL THEN NULL ELSE created_by::text END
		FROM client_cert_cas
		ORDER BY is_builtin DESC, created_at
	`)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"CA listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	var out []caResponse
	for rows.Next() {
		var ca caResponse
		if err := rows.Scan(&ca.ID, &ca.Name, &ca.CertPEM, &ca.IsBuiltin, &ca.CreatedAt, &ca.CreatedBy); err != nil {
			h.Logger.Warn("client cert CA scan failed", slog.String("error", err.Error()))
			continue
		}
		out = append(out, ca)
	}
	if out == nil {
		out = []caResponse{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"cas": out})
}

type uploadCARequest struct {
	Name    string `json:"name"`
	CertPEM string `json:"cert_pem"`
}

// UploadCA implements POST /api/v1/admin/client-cert-cas — registers an external CA.
func (h *ClientCertHandlers) UploadCA(w http.ResponseWriter, r *http.Request) {
	var req uploadCARequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.CertPEM) == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"name ve cert_pem zorunlu.", errors.New("missing fields"))
		return
	}

	// Validate PEM is parseable as a CA cert.
	caCert, err := clientcert.ParseCACert(req.CertPEM)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz CA sertifikası: "+err.Error(), err)
		return
	}
	if !caCert.IsCA {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Yüklenen sertifika bir CA değil (IsCA=false).", errors.New("not a CA cert"))
		return
	}

	claims := ClaimsFromContext(r.Context())
	actorID := ""
	if claims != nil {
		actorID = claims.Subject
	}

	ctx := r.Context()
	var caID, createdAt string
	err = h.Service.DB.QueryRow(ctx, `
		INSERT INTO client_cert_cas (name, cert_pem, is_builtin, created_by)
		VALUES ($1, $2, false, NULLIF($3, '')::uuid)
		RETURNING id::text, created_at::text
	`, req.Name, req.CertPEM, actorID).Scan(&caID, &createdAt)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"CA kaydedilemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  actorID,
		Action:       audit.ActionAdminClientCertCARegistered,
		ResourceType: "client_cert_ca",
		ResourceID:   caID,
		Details:      map[string]any{"name": req.Name},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	var byPtr *string
	if actorID != "" {
		byPtr = &actorID
	}
	writeJSON(w, http.StatusCreated, caResponse{
		ID:        caID,
		Name:      req.Name,
		CertPEM:   req.CertPEM,
		IsBuiltin: false,
		CreatedAt: createdAt,
		CreatedBy: byPtr,
	})
}

// DeleteCA implements DELETE /api/v1/admin/client-cert-cas/{ca_id}.
// Only non-builtin CAs with no certificate references can be deleted.
func (h *ClientCertHandlers) DeleteCA(w http.ResponseWriter, r *http.Request) {
	caID := chi.URLParam(r, "ca_id")
	if caID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"ca_id zorunlu.", errors.New("missing ca_id"))
		return
	}

	ctx := r.Context()

	var isBuiltin bool
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT is_builtin FROM client_cert_cas WHERE id = $1::uuid`, caID,
	).Scan(&isBuiltin); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"CA bulunamadı.", err)
		return
	}
	if isBuiltin {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Built-in CA silinemez.", errors.New("builtin CA cannot be deleted"))
		return
	}

	// Prevent deleting if any certs reference this CA.
	var refCount int
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT count(*) FROM client_certificates WHERE ca_id = $1::uuid`, caID,
	).Scan(&refCount); err == nil && refCount > 0 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Bu CA'ya bağlı sertifikalar var. Önce tüm sertifikaları iptal edin.",
			errors.New("ca has references"))
		return
	}

	tag, err := h.Service.DB.Exec(ctx,
		`DELETE FROM client_cert_cas WHERE id = $1::uuid AND is_builtin = false`, caID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"CA silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	claims := ClaimsFromContext(r.Context())
	actorID := ""
	if claims != nil {
		actorID = claims.Subject
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  actorID,
		Action:       audit.ActionAdminClientCertCADeleted,
		ResourceType: "client_cert_ca",
		ResourceID:   caID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// ---- User certificate management ----

type clientCertListItem struct {
	ID                string  `json:"id"`
	CAID              string  `json:"ca_id"`
	CAName            string  `json:"ca_name"`
	FingerprintSHA256 string  `json:"fingerprint_sha256"`
	SubjectCN         string  `json:"subject_cn"`
	SerialNumber      string  `json:"serial_number"`
	NotBefore         string  `json:"not_before"`
	NotAfter          string  `json:"not_after"`
	RevokedAt         *string `json:"revoked_at,omitempty"`
	Label             *string `json:"label,omitempty"`
	CreatedAt         string  `json:"created_at"`
}

// ListUserCerts implements GET /api/v1/admin/users/{id}/client-certs.
func (h *ClientCertHandlers) ListUserCerts(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	ctx := r.Context()
	rows, err := h.Service.DB.Query(ctx, `
		SELECT cc.id::text, cc.ca_id::text, ca.name,
		       encode(cc.fingerprint_sha256, 'hex'),
		       cc.subject_cn, cc.serial_number,
		       cc.not_before::text, cc.not_after::text,
		       cc.revoked_at::text, cc.label, cc.created_at::text
		FROM client_certificates cc
		JOIN client_cert_cas ca ON ca.id = cc.ca_id
		WHERE cc.user_id = $1::uuid
		ORDER BY cc.created_at DESC
	`, userID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Sertifika listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	var out []clientCertListItem
	for rows.Next() {
		var c clientCertListItem
		if err := rows.Scan(
			&c.ID, &c.CAID, &c.CAName,
			&c.FingerprintSHA256,
			&c.SubjectCN, &c.SerialNumber,
			&c.NotBefore, &c.NotAfter,
			&c.RevokedAt, &c.Label, &c.CreatedAt,
		); err != nil {
			h.Logger.Warn("cert scan failed", slog.String("error", err.Error()))
			continue
		}
		out = append(out, c)
	}
	if out == nil {
		out = []clientCertListItem{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"certs": out})
}

type issueCertRequest struct {
	Label    *string `json:"label"`
	ValidFor *int    `json:"valid_for_days"` // optional; 0 = DefaultCertValidity
}

type issueCertResponse struct {
	clientCertListItem
	// CertPEM and KeyPEM are shown ONCE — the server does NOT store the private key.
	CertPEM string `json:"cert_pem"`
	KeyPEM  string `json:"key_pem"`
}

// IssueCert implements POST /api/v1/admin/users/{id}/client-certs/issue.
// Issues a leaf certificate from the built-in CA and returns cert+key PEM once.
func (h *ClientCertHandlers) IssueCert(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	// Body is optional; decode best-effort.
	var req issueCertRequest
	if r.ContentLength > 0 {
		dec := json.NewDecoder(r.Body)
		_ = dec.Decode(&req) // silently ignore decode errors (empty body = defaults)
	}

	ctx := r.Context()

	// Load the built-in CA.
	ca, err := clientcert.LoadBuiltinCA(ctx, h.Service.DB, h.Service.Master)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Built-in CA yüklenemedi.", err)
		return
	}

	// Resolve username for the subject CN.
	var username string
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT username FROM users WHERE id = $1::uuid`, userID,
	).Scan(&username); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Kullanıcı bulunamadı.", err)
		return
	}

	validity := clientcert.DefaultCertValidity
	if req.ValidFor != nil && *req.ValidFor > 0 {
		validity = time.Duration(*req.ValidFor) * 24 * time.Hour
	}

	issued, err := clientcert.IssueCert(ca, username, validity)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Sertifika üretilemedi.", err)
		return
	}

	// Fetch CA name.
	var caName string
	_ = h.Service.DB.QueryRow(ctx, `SELECT name FROM client_cert_cas WHERE id = $1::uuid`, ca.ID).Scan(&caName)

	// Insert the new cert record.
	var certID, notBefore, notAfter, createdAt string
	err = h.Service.DB.QueryRow(ctx, `
		INSERT INTO client_certificates
		    (user_id, ca_id, fingerprint_sha256, subject_cn, serial_number, not_before, not_after, label)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
		RETURNING id::text, not_before::text, not_after::text, created_at::text
	`, userID, ca.ID,
		issued.FingerprintBytes, issued.SubjectCN, issued.SerialNumber,
		issued.NotBefore.Format(time.RFC3339), issued.NotAfter.Format(time.RFC3339),
		req.Label,
	).Scan(&certID, &notBefore, &notAfter, &createdAt)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Sertifika kaydedilemedi.", err)
		return
	}

	claims := ClaimsFromContext(r.Context())
	actorID := ""
	if claims != nil {
		actorID = claims.Subject
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  actorID,
		Action:       audit.ActionAdminClientCertIssued,
		ResourceType: "client_certificate",
		ResourceID:   certID,
		Details:      map[string]any{"user_id": userID, "subject_cn": issued.SubjectCN, "fingerprint": issued.FingerprintSHA256},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, issueCertResponse{
		clientCertListItem: clientCertListItem{
			ID:                certID,
			CAID:              ca.ID,
			CAName:            caName,
			FingerprintSHA256: issued.FingerprintSHA256,
			SubjectCN:         issued.SubjectCN,
			SerialNumber:      issued.SerialNumber,
			NotBefore:         notBefore,
			NotAfter:          notAfter,
			Label:             req.Label,
			CreatedAt:         createdAt,
		},
		CertPEM: issued.CertPEM,
		KeyPEM:  issued.KeyPEM,
	})
}

type registerCertRequest struct {
	CertPEM string  `json:"cert_pem"`
	CAID    string  `json:"ca_id"`
	Label   *string `json:"label"`
}

// RegisterCert implements POST /api/v1/admin/users/{id}/client-certs/register.
// Registers an externally-issued certificate for a user (admin uploads PEM only).
func (h *ClientCertHandlers) RegisterCert(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	var req registerCertRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.CertPEM == "" || req.CAID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"cert_pem ve ca_id zorunlu.", errors.New("missing fields"))
		return
	}

	fp, cert, err := clientcert.FingerprintFromPEM(req.CertPEM)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz sertifika PEM: "+err.Error(), err)
		return
	}

	ctx := r.Context()

	// Verify the CA exists.
	var caName string
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT name FROM client_cert_cas WHERE id = $1::uuid`, req.CAID,
	).Scan(&caName); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Belirtilen CA bulunamadı.", err)
		return
	}

	fpHex := hex.EncodeToString(fp)
	var certID, notBefore, notAfter, createdAt string
	err = h.Service.DB.QueryRow(ctx, `
		INSERT INTO client_certificates
		    (user_id, ca_id, fingerprint_sha256, subject_cn, serial_number, not_before, not_after, label)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
		RETURNING id::text, not_before::text, not_after::text, created_at::text
	`, userID, req.CAID,
		fp, cert.Subject.CommonName, cert.SerialNumber.String(),
		cert.NotBefore.Format(time.RFC3339), cert.NotAfter.Format(time.RFC3339),
		req.Label,
	).Scan(&certID, &notBefore, &notAfter, &createdAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu sertifika zaten kayıtlı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Sertifika kaydedilemedi.", err)
		return
	}

	claims := ClaimsFromContext(r.Context())
	actorID := ""
	if claims != nil {
		actorID = claims.Subject
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  actorID,
		Action:       audit.ActionAdminClientCertRegistered,
		ResourceType: "client_certificate",
		ResourceID:   certID,
		Details:      map[string]any{"user_id": userID, "ca_id": req.CAID, "fingerprint": fpHex},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, clientCertListItem{
		ID:                certID,
		CAID:              req.CAID,
		CAName:            caName,
		FingerprintSHA256: fpHex,
		SubjectCN:         cert.Subject.CommonName,
		SerialNumber:      cert.SerialNumber.String(),
		NotBefore:         notBefore,
		NotAfter:          notAfter,
		Label:             req.Label,
		CreatedAt:         createdAt,
	})
}

// RevokeCert implements DELETE /api/v1/admin/users/{id}/client-certs/{cert_id}.
// Sets revoked_at = now() — preserves audit trail.
func (h *ClientCertHandlers) RevokeCert(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	certID := chi.URLParam(r, "cert_id")
	if userID == "" || certID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve cert_id zorunlu.", errors.New("missing path params"))
		return
	}

	ctx := r.Context()
	tag, err := h.Service.DB.Exec(ctx, `
		UPDATE client_certificates
		SET revoked_at = now()
		WHERE id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL
	`, certID, userID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Sertifika iptal edilemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		w.WriteHeader(http.StatusNoContent) // already revoked or not found
		return
	}

	claims := ClaimsFromContext(r.Context())
	actorID := ""
	if claims != nil {
		actorID = claims.Subject
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  actorID,
		Action:       audit.ActionAdminClientCertRevoked,
		ResourceType: "client_certificate",
		ResourceID:   certID,
		Details:      map[string]any{"user_id": userID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

type certRequiredRequest struct {
	Required bool `json:"required"`
}

// SetCertRequired implements PATCH /api/v1/admin/users/{id}/cert-required.
// Toggles users.requires_client_cert for the given user.
func (h *ClientCertHandlers) SetCertRequired(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	var req certRequiredRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}

	ctx := r.Context()
	tag, err := h.Service.DB.Exec(ctx,
		`UPDATE users SET requires_client_cert = $1 WHERE id = $2::uuid`, req.Required, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Sertifika zorunluluğu güncellenemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Kullanıcı bulunamadı.", errors.New("user not found"))
		return
	}

	claims := ClaimsFromContext(r.Context())
	actorID := ""
	if claims != nil {
		actorID = claims.Subject
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  actorID,
		Action:       audit.ActionAdminClientCertRequirementChanged,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		Details:      map[string]any{"required": req.Required},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

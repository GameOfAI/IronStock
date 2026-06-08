package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/email"
)

// forgotPasswordRequest, POST /api/v1/auth/forgot-password body.
type forgotPasswordRequest struct {
	Email string `json:"email"`
}

// resetPasswordRequest, POST /api/v1/auth/reset-password body.
type resetPasswordRequest struct {
	Token         string         `json:"token"` // 32-byte hex token (URL'den gelen plain token)
	NewPassword   string         `json:"new_password"`
	PublicKey     []byte         `json:"public_key"`      // yeni E2E keypair (X25519, 32 byte)
	PrivateKeyEnc []byte         `json:"private_key_enc"` // yeni KEK ile şifreli private key
	KEKSalt       []byte         `json:"kek_salt"`
	KEKParams     map[string]any `json:"kek_params"`
}

// ForgotPassword — POST /api/v1/auth/forgot-password
//
// Email enumeration koruması: her zaman 200 OK döner.
// Email veritabanında kayıtlıysa sıfırlama linki arka planda gönderilir.
func (s *AuthHandlers) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}

	// Her zaman 200 OK — enumeration koruması
	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Eğer bu e-posta kayıtlıysa sıfırlama linki gönderildi.",
	})

	go s.processForgotPassword(req.Email, r.RemoteAddr, r.UserAgent())
}

func (s *AuthHandlers) processForgotPassword(emailAddr, remoteAddr, userAgent string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Kullanıcıyı e-posta ile bul
	const findSQL = `
		SELECT id::text, username FROM users
		WHERE LOWER(email) = LOWER($1) AND status = 'active'
		LIMIT 1
	`
	var userID, username string
	err := s.Service.DB.QueryRow(ctx, findSQL, emailAddr).Scan(&userID, &username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return // Sessizce çık — enumeration koruması
		}
		s.Logger.Warn("forgot-password: user lookup failed", "error", err)
		return
	}

	// Rate limit: aynı kullanıcı için son 1 saatte 5'ten fazla token oluşturulamasın
	const countSQL = `
		SELECT COUNT(*) FROM password_reset_tokens
		WHERE user_id = $1::uuid
		  AND created_at > now() - interval '1 hour'
		  AND used_at IS NULL
	`
	var count int
	_ = s.Service.DB.QueryRow(ctx, countSQL, userID).Scan(&count)
	if count >= 5 {
		return // Rate limit aşıldı, sessizce çık
	}

	// 32-byte güvenli rastgele token üret
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		s.Logger.Error("forgot-password: rand.Read failed", "error", err)
		return
	}
	tokenHex := hex.EncodeToString(rawToken) // URL'de kullanılacak plain hex

	// SHA-256 hash — DB'ye sadece hash saklanır
	sum := sha256.Sum256(rawToken)
	tokenHash := sum[:]

	ttlMin := s.PasswordResetTTL
	if ttlMin <= 0 {
		ttlMin = 60
	}
	ttl := time.Duration(ttlMin) * time.Minute
	expiresAt := time.Now().Add(ttl)

	ip := parseIP(remoteAddr)
	ipStr := ""
	if ip.IsValid() {
		ipStr = ip.String()
	}

	const insertSQL = `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
		VALUES ($1::uuid, $2, $3, $4::inet, $5)
	`
	if _, err := s.Service.DB.Exec(ctx, insertSQL, userID, tokenHash, expiresAt, ipStr, userAgent); err != nil {
		s.Logger.Error("forgot-password: insert token failed", "error", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       "auth.password_reset_requested",
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
	})

	if s.EmailClient == nil {
		s.Logger.Warn("forgot-password: EmailClient nil, e-posta gönderilemedi", "user_id", userID)
		return
	}

	appURL := s.AppURL
	resetURL := fmt.Sprintf("%s/reset-password?token=%s", appURL, tokenHex)
	s.EmailClient.SendTemplateAsync(emailAddr, "password_reset", email.TemplateData{
		Username:    username,
		ResetURL:    resetURL,
		ExpiresIn:   fmt.Sprintf("%d dakika", ttlMin),
		RequestedAt: time.Now().Format("02.01.2006 15:04"),
		IPAddress:   ipStr,
	})
}

// ResetPassword — POST /api/v1/auth/reset-password
//
// Token doğrula → yeni şifre hash'le → yeni E2E keypair kaydet → tüm sessionları iptal et.
//
// KRİTİK: Şifre sıfırlama, eski E2E private key'i geçersiz kılar. Eski item_shares
// (DEK'ler eski public key ile wrap edilmişti) artık erişilemez olur.
// Frontend büyük amber uyarı göstermelidir.
func (s *AuthHandlers) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}

	if err := validateResetPasswordRequest(req); err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

	// Token hex → bytes
	rawToken, err := hex.DecodeString(req.Token)
	if err != nil || len(rawToken) != 32 {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz token formatı.", nil)
		return
	}

	sum := sha256.Sum256(rawToken)
	tokenHash := sum[:]

	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Token'ı bul — süresi dolmamış, kullanılmamış
	const findTokenSQL = `
		SELECT id::text, user_id::text
		FROM password_reset_tokens
		WHERE token_hash = $1
		  AND expires_at > now()
		  AND used_at IS NULL
		FOR UPDATE
	`
	var tokenID, userID string
	err = tx.QueryRow(ctx, findTokenSQL, tokenHash).Scan(&tokenID, &userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"Geçersiz veya süresi dolmuş token.", nil)
			return
		}
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Token doğrulama hatası.", err)
		return
	}

	// Yeni şifreyi hash'le
	hp, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre işlenirken hata oluştu.", err)
		return
	}

	kekParamsJSON, err := marshalJSON(req.KEKParams)
	if err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"kek_params geçersiz.", err)
		return
	}

	// Kullanıcı şifresini güncelle
	const updateUserSQL = `
		UPDATE users SET password_hash = $2, argon2_params = $3
		WHERE id = $1::uuid
	`
	if _, err := tx.Exec(ctx, updateUserSQL, userID, hp.Hash, hp.ParamsJSON); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre güncellenemedi.", err)
		return
	}

	// Argon2 salt'ını güncelle (base64 encoded)
	saltB64 := base64.StdEncoding.EncodeToString(hp.Salt)
	const updateSaltSQL = `
		UPDATE users
		SET argon2_params = argon2_params || jsonb_build_object('salt_b64', $2::text)
		WHERE id = $1::uuid
	`
	if _, err := tx.Exec(ctx, updateSaltSQL, userID, saltB64); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı parametreleri güncellenemedi.", err)
		return
	}

	// Yeni keypair'i upsert et (eski keypair geçersiz olur)
	const upsertKeypairSQL = `
		INSERT INTO user_keypairs (user_id, public_key, private_key_enc, kek_salt, kek_params)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET
			public_key      = EXCLUDED.public_key,
			private_key_enc = EXCLUDED.private_key_enc,
			kek_salt        = EXCLUDED.kek_salt,
			kek_params      = EXCLUDED.kek_params,
			updated_at      = now()
	`
	if _, err := tx.Exec(ctx, upsertKeypairSQL,
		userID, req.PublicKey, req.PrivateKeyEnc, req.KEKSalt, kekParamsJSON,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Anahtar çifti güncellenemedi.", err)
		return
	}

	// Token'ı kullanılmış olarak işaretle
	const markUsedSQL = `
		UPDATE password_reset_tokens SET used_at = now() WHERE id = $1::uuid
	`
	if _, err := tx.Exec(ctx, markUsedSQL, tokenID); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Token güncellenemedi.", err)
		return
	}

	// Tüm aktif session'ları iptal et
	const revokeSessionsSQL = `
		UPDATE sessions SET revoked = true WHERE user_id = $1::uuid AND revoked = false
	`
	_, _ = tx.Exec(ctx, revokeSessionsSQL, userID)

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       "auth.password_reset_completed",
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Şifreniz başarıyla sıfırlandı. Lütfen yeni şifrenizle giriş yapın.",
	})
}

func validateResetPasswordRequest(req resetPasswordRequest) error {
	if len(req.Token) == 0 {
		return errors.New("token gerekli")
	}
	if len(req.NewPassword) < 12 {
		return errors.New("new_password en az 12 karakter olmalıdır")
	}
	if len(req.PublicKey) != 32 {
		return errors.New("public_key 32 byte (X25519) olmalıdır")
	}
	if len(req.PrivateKeyEnc) == 0 {
		return errors.New("private_key_enc gerekli")
	}
	if len(req.KEKSalt) < 16 {
		return errors.New("kek_salt en az 16 byte olmalıdır")
	}
	if len(req.KEKParams) == 0 {
		return errors.New("kek_params gerekli")
	}
	return nil
}

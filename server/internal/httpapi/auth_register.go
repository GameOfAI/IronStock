package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// registerRequest matches the OpenAPI RegisterRequest schema.
type registerRequest struct {
	Username       string         `json:"username"`
	Email          string         `json:"email"`
	MasterPassword string         `json:"master_password"`
	PublicKey      []byte         `json:"public_key"`      // base64 in JSON
	PrivateKeyEnc  []byte         `json:"private_key_enc"` // base64 in JSON
	KEKSalt        []byte         `json:"kek_salt"`        // base64 in JSON
	KEKParams      map[string]any `json:"kek_params"`
}

type registerResponse struct {
	UserID   string `json:"user_id"`
	TmpToken string `json:"tmp_token"`
}

// usernameRE permits ASCII letters/digits/._- of length 3-64. Lowercase only
// to keep search/comparison simple.
var usernameRE = regexp.MustCompile(`^[a-zA-Z0-9._-]{3,64}$`)

// Register implements POST /api/v1/auth/register.
//
// Steps:
//  1. Validate input (username/email shape, key lengths).
//  2. Hash password (Argon2id, server-side salt).
//  3. Marshal kek_params, validate sizes.
//  4. INSERT users (status='active') + INSERT user_keypairs in a tx.
//  5. Issue tmp token (purpose=totp_enroll) for optional /totp/init+verify calls.
//  6. Audit log auth.register, return 201.
func (s *AuthHandlers) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if err := validateRegisterRequest(req); err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	hp, err := auth.HashPassword(req.MasterPassword)
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

	ctx := r.Context()
	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertUserSQL = `
		INSERT INTO users (username, email, password_hash, argon2_params, status)
		VALUES ($1, $2, $3, $4, 'active')
		RETURNING id::text
	`
	var userID string
	err = tx.QueryRow(ctx, insertUserSQL,
		strings.ToLower(req.Username),
		strings.ToLower(req.Email),
		hp.Hash,
		hp.ParamsJSON,
	).Scan(&userID)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, s.Logger, http.StatusConflict, ErrCodeConflict,
				"Kullanıcı adı veya e-posta zaten kullanımda.", err)
			return
		}
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı oluşturulamadı.", err)
		return
	}

	// users.password_hash holds the Argon2 hash; the salt that produced it is
	// stored separately in argon2_params -> "salt" so callers can re-verify.
	// Our HashedPassword returns Salt as []byte; persist it as part of the
	// encoded params JSON for forward compatibility.
	if err := persistArgon2Salt(ctx, tx, userID, hp); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı parametreleri yazılamadı.", err)
		return
	}

	const insertKeypairSQL = `
		INSERT INTO user_keypairs (
			user_id, public_key, private_key_enc, kek_salt, kek_params
		) VALUES ($1, $2, $3, $4, $5)
	`
	if _, err := tx.Exec(ctx, insertKeypairSQL,
		userID, req.PublicKey, req.PrivateKeyEnc, req.KEKSalt, kekParamsJSON,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Anahtar çifti kaydedilemedi.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	tmpToken, err := s.Service.JWT.IssueTmp(userID, auth.PurposeTOTPEnroll)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Geçici token üretilemedi.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthRegister,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, registerResponse{
		UserID:   userID,
		TmpToken: tmpToken,
	})
}

func validateRegisterRequest(r registerRequest) error {
	if !usernameRE.MatchString(r.Username) {
		return errors.New("username 3-64 ASCII alphanumerics/._-")
	}
	if !strings.Contains(r.Email, "@") || len(r.Email) < 3 || len(r.Email) > 255 {
		return errors.New("email format invalid")
	}
	if len(r.MasterPassword) < 12 {
		return errors.New("master_password must be >= 12 characters")
	}
	if len(r.PublicKey) != 32 {
		return errors.New("public_key must be 32 bytes (X25519)")
	}
	if len(r.PrivateKeyEnc) == 0 {
		return errors.New("private_key_enc is required")
	}
	if len(r.KEKSalt) < 16 {
		return errors.New("kek_salt must be >= 16 bytes")
	}
	if len(r.KEKParams) == 0 {
		return errors.New("kek_params is required")
	}
	return nil
}

// parseIP extracts the netip.Addr from a "host:port" RemoteAddr.
// Returns invalid Addr on failure (audit writer treats invalid as NULL).
func parseIP(remote string) netip.Addr {
	addrPort, err := netip.ParseAddrPort(remote)
	if err != nil {
		// remote may already be just an IP (no port) in some test setups
		if a, err2 := netip.ParseAddr(remote); err2 == nil {
			return a
		}
		return netip.Addr{}
	}
	return addrPort.Addr()
}

// isUniqueViolation reports whether err is a Postgres unique-constraint failure.
func isUniqueViolation(err error) bool {
	var pgErr interface{ Code() string }
	if errors.As(err, &pgErr) {
		return pgErr.Code() == "23505"
	}
	return false
}

// persistArgon2Salt updates users.argon2_params with the salt embedded so
// VerifyPassword has everything it needs without a separate column.
func persistArgon2Salt(ctx context.Context, tx pgx.Tx, userID string, hp auth.HashedPassword) error {
	encoded := base64.StdEncoding.EncodeToString(hp.Salt)
	const sqlText = `
		UPDATE users
		SET argon2_params = argon2_params || jsonb_build_object('salt_b64', $2::text)
		WHERE id = $1::uuid
	`
	_, err := tx.Exec(ctx, sqlText, userID, encoded)
	return err
}

// marshalJSON serializes arbitrary maps to jsonb-friendly bytes.
func marshalJSON(v any) ([]byte, error) {
	if v == nil {
		return []byte("null"), nil
	}
	return json.Marshal(v)
}

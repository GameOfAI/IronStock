package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// ErrorResponse matches the OpenAPI Error schema (shared/api/openapi.yaml).
type ErrorResponse struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// Error codes used in API responses (machine-readable, stable). See
// docs/auth-flow.md "Error Codes" for the full list.
const (
	ErrCodeBadRequest        = "bad_request"
	ErrCodeUnauthorized      = "unauthorized"
	ErrCodeInvalidCreds      = "invalid_credentials" //nolint:gosec // G101 false positive — error-code identifier, not a secret
	ErrCodeInvalidMFA        = "invalid_mfa"
	ErrCodeInvalidCode       = "invalid_code"
	ErrCodeInvalidToken      = "invalid_token"
	ErrCodeAccountLocked     = "account_locked"
	ErrCodeAccountPendingMFA = "account_pending_totp"
	ErrCodeMFARequired       = "mfa_required"
	ErrCodeRateLimited       = "rate_limited"
	ErrCodeForbidden         = "forbidden"
	ErrCodeValidation        = "validation_error"
	ErrCodeNotFound          = "not_found"
	ErrCodeConflict          = "conflict"
	ErrCodeInternal          = "internal_error"
	// ErrCodeClientCertRequired is returned when a user has requires_client_cert=true
	// but no valid client certificate was presented at login (PR-SEC3).
	ErrCodeClientCertRequired = "client_cert_required" //nolint:gosec // G101 false positive
	// ErrCodeClientCertInvalid is returned when a client cert is presented but
	// fails validation (not registered, revoked, expired, wrong user) (PR-SEC3).
	ErrCodeClientCertInvalid = "client_cert_invalid" //nolint:gosec // G101 false positive
)

// writeError emits a JSON error response and logs internal errors at warn level.
//
// userMessage is shown to the API caller (Turkish, user-friendly). cause is
// the underlying server error, redacted from the response but logged.
func writeError(w http.ResponseWriter, logger *slog.Logger, status int, code, userMessage string, cause error) {
	if cause != nil && status >= 500 {
		logger.Warn("http error",
			slog.Int("status", status),
			slog.String("code", code),
			slog.String("error", cause.Error()),
		)
	}
	writeJSON(w, status, ErrorResponse{
		Code:    code,
		Message: userMessage,
	})
}

// writeInvalidCreds writes the canonical 401 invalid_credentials response.
// Used by login (any factor failed) and refresh (token unknown / expired).
// The Turkish user message intentionally does not say which factor failed —
// don't give the attacker an oracle.
func writeInvalidCreds(w http.ResponseWriter, logger *slog.Logger, cause error) {
	writeError(w, logger, http.StatusUnauthorized, ErrCodeInvalidCreds,
		"Kullanıcı adı, şifre veya TOTP kodu hatalı.", cause)
}

// decodeJSON reads and decodes the request body into dst. Returns false (and
// writes a 400 response) on error so the handler can return immediately.
func decodeJSON(w http.ResponseWriter, r *http.Request, logger *slog.Logger, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB cap
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, logger, http.StatusBadRequest, ErrCodeBadRequest,
			"İstek gövdesi geçersiz.", err)
		return false
	}
	return true
}

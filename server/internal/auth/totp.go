package auth

import (
	"errors"
	"fmt"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// TOTP defaults (RFC 6238 + Google Authenticator standard):
const (
	TOTPDigits     = otp.DigitsSix
	TOTPPeriod     = 30 // seconds
	TOTPAlgorithm  = otp.AlgorithmSHA1
	TOTPSecretSize = 20 // 160 bits, RFC 6238 recommendation
	// TOTPVerifySkew accepts codes from ±1 30-second windows around now to
	// tolerate small clock drift. Larger skews risk replay; do not increase.
	TOTPVerifySkew = 1
)

// ErrInvalidTOTPCode is returned when a code fails verification.
var ErrInvalidTOTPCode = errors.New("auth: invalid TOTP code")

// TOTPEnrollment is the result of generating a fresh TOTP secret for a user.
type TOTPEnrollment struct {
	// Secret is the raw 20-byte TOTP secret. Caller envelope-encrypts and
	// stores in totp_secrets.secret_enc.
	Secret []byte
	// Base32 is the same secret encoded for manual entry into authenticator
	// apps that don't scan QR codes.
	Base32 string
	// OtpAuthURL is `otpauth://totp/Issuer:account?secret=...`. Render as a
	// QR code on the enrolment page.
	OtpAuthURL string
}

// GenerateTOTP creates a fresh secret and otpauth URL for the given account
// (typically the user's username). issuer is the app name shown in
// authenticator apps ("Envanter").
func GenerateTOTP(issuer, account string) (TOTPEnrollment, error) {
	if issuer == "" {
		return TOTPEnrollment{}, errors.New("auth: TOTP issuer is required")
	}
	if account == "" {
		return TOTPEnrollment{}, errors.New("auth: TOTP account is required")
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: account,
		SecretSize:  TOTPSecretSize,
		Algorithm:   TOTPAlgorithm,
		Period:      TOTPPeriod,
		Digits:      TOTPDigits,
	})
	if err != nil {
		return TOTPEnrollment{}, fmt.Errorf("auth: totp.Generate: %w", err)
	}
	// pquerna/otp returns Base32 via key.Secret(); decode for raw bytes.
	rawSecret, err := decodeTOTPBase32(key.Secret())
	if err != nil {
		return TOTPEnrollment{}, fmt.Errorf("auth: decode totp secret: %w", err)
	}
	return TOTPEnrollment{
		Secret:     rawSecret,
		Base32:     key.Secret(),
		OtpAuthURL: key.URL(),
	}, nil
}

// VerifyTOTP returns nil if code is valid for secret at the current time,
// within ±TOTPVerifySkew windows. Returns ErrInvalidTOTPCode otherwise.
func VerifyTOTP(secret []byte, code string) error {
	if len(secret) == 0 {
		return errors.New("auth: empty TOTP secret")
	}
	base32Secret := encodeTOTPBase32(secret)
	valid, err := totp.ValidateCustom(code, base32Secret, nowFn(), totp.ValidateOpts{
		Period:    TOTPPeriod,
		Skew:      TOTPVerifySkew,
		Digits:    TOTPDigits,
		Algorithm: TOTPAlgorithm,
	})
	if err != nil {
		return fmt.Errorf("auth: validate TOTP: %w", err)
	}
	if !valid {
		return ErrInvalidTOTPCode
	}
	return nil
}

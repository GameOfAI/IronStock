package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

func TestGenerateTOTP_Fields(t *testing.T) {
	e, err := GenerateTOTP("Envanter", "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Secret) != TOTPSecretSize {
		t.Errorf("Secret len = %d, want %d", len(e.Secret), TOTPSecretSize)
	}
	if e.Base32 == "" {
		t.Error("Base32 empty")
	}
	if !strings.HasPrefix(e.OtpAuthURL, "otpauth://totp/") {
		t.Errorf("OtpAuthURL = %q, want otpauth:// prefix", e.OtpAuthURL)
	}
	if !strings.Contains(e.OtpAuthURL, "issuer=Envanter") {
		t.Errorf("OtpAuthURL missing issuer: %q", e.OtpAuthURL)
	}
}

func TestGenerateTOTP_RejectsEmptyInput(t *testing.T) {
	if _, err := GenerateTOTP("", "x"); err == nil {
		t.Error("accepted empty issuer")
	}
	if _, err := GenerateTOTP("x", ""); err == nil {
		t.Error("accepted empty account")
	}
}

func TestVerifyTOTP_RoundTrip(t *testing.T) {
	e, err := GenerateTOTP("Envanter", "alice")
	if err != nil {
		t.Fatal(err)
	}
	// Generate the current code from the same secret.
	code, err := totp.GenerateCode(e.Base32, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyTOTP(e.Secret, code); err != nil {
		t.Errorf("VerifyTOTP(valid code): %v", err)
	}
}

func TestVerifyTOTP_RejectsWrongCode(t *testing.T) {
	e, err := GenerateTOTP("Envanter", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyTOTP(e.Secret, "000000"); !errors.Is(err, ErrInvalidTOTPCode) {
		// Note: 000000 has a tiny chance of being valid by accident; if so,
		// try 123456 — odds of both succeeding randomly are 1 in 10^12.
		if err := VerifyTOTP(e.Secret, "123456"); !errors.Is(err, ErrInvalidTOTPCode) {
			t.Errorf("VerifyTOTP rejected wrong code with err = %v, want ErrInvalidTOTPCode", err)
		}
	}
}

func TestVerifyTOTP_EmptySecret(t *testing.T) {
	if err := VerifyTOTP(nil, "123456"); err == nil {
		t.Error("VerifyTOTP accepted empty secret")
	}
}

func TestEncodeDecodeTOTPBase32_RoundTrip(t *testing.T) {
	raw := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	encoded := encodeTOTPBase32(raw)
	decoded, err := decodeTOTPBase32(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(raw) {
		t.Errorf("roundtrip mismatch: %x vs %x", decoded, raw)
	}
}

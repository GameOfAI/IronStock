package auth

import (
	"encoding/base32"
	"time"
)

// nowFn is overridable for tests.
//
//nolint:gochecknoglobals // test seam
var nowFn = time.Now

// totpBase32 is the encoding pquerna/otp uses (no padding, uppercase).
//
//nolint:gochecknoglobals // package-level encoder is idiomatic
var totpBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func encodeTOTPBase32(raw []byte) string {
	return totpBase32.EncodeToString(raw)
}

func decodeTOTPBase32(s string) ([]byte, error) {
	return totpBase32.DecodeString(s)
}

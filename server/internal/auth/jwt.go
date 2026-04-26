package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWT lifetimes.
const (
	// AccessTokenLifetime is the JWT access-token validity. Short by design;
	// rotation is via the refresh-token mechanism.
	AccessTokenLifetime = 15 * time.Minute
	// TmpTokenLifetime is the validity of a single-purpose token issued at
	// register-time (TOTP enrolment) or recovery-init (password reset).
	TmpTokenLifetime = 15 * time.Minute

	// JWT issuer claim: identifies our app uniformly across token types.
	jwtIssuer = "envanter-api"
)

// Token purposes.
const (
	PurposeAccess     = "access"
	PurposeTOTPEnroll = "totp-enroll"
	PurposeRecovery   = "recovery"
)

// ErrJWTInvalid is returned for malformed, expired, or signature-mismatched tokens.
var ErrJWTInvalid = errors.New("auth: invalid JWT")

// ErrJWTWrongPurpose is returned when a token's purpose claim does not match
// what the caller expected (e.g., presenting a tmp token to /api/v1/items).
var ErrJWTWrongPurpose = errors.New("auth: JWT purpose mismatch")

// Claims is the canonical claim set used for both access and tmp tokens.
//
// JTI is empty for tmp tokens (no session row); for access tokens it is the
// session UUID, used for revocation checks (PR-6 will plug this in).
type Claims struct {
	Purpose string   `json:"purpose"`
	Roles   []string `json:"roles,omitempty"`
	jwt.RegisteredClaims
}

// JWTSigner produces and validates HS256 tokens with a fixed secret.
type JWTSigner struct {
	secret []byte
}

// NewJWTSigner accepts a >= 32-byte secret (HS256 security floor, RFC 7518 §3.2).
func NewJWTSigner(secret []byte) (*JWTSigner, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("auth: JWT secret length = %d, want >= 32", len(secret))
	}
	dup := make([]byte, len(secret))
	copy(dup, secret)
	return &JWTSigner{secret: dup}, nil
}

// IssueAccess produces a 15-minute access token bound to a session.
func (s *JWTSigner) IssueAccess(userID, sessionID string, roles []string) (string, error) {
	return s.issue(Claims{
		Purpose: PurposeAccess,
		Roles:   roles,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ID:        sessionID,
			ExpiresAt: jwt.NewNumericDate(nowFn().Add(AccessTokenLifetime)),
			IssuedAt:  jwt.NewNumericDate(nowFn()),
			NotBefore: jwt.NewNumericDate(nowFn()),
			Issuer:    jwtIssuer,
		},
	})
}

// IssueTmp produces a single-purpose 15-minute token (TOTP enroll / recovery).
func (s *JWTSigner) IssueTmp(userID, purpose string) (string, error) {
	if purpose != PurposeTOTPEnroll && purpose != PurposeRecovery {
		return "", fmt.Errorf("auth: invalid tmp purpose %q", purpose)
	}
	return s.issue(Claims{
		Purpose: purpose,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(nowFn().Add(TmpTokenLifetime)),
			IssuedAt:  jwt.NewNumericDate(nowFn()),
			NotBefore: jwt.NewNumericDate(nowFn()),
			Issuer:    jwtIssuer,
		},
	})
}

func (s *JWTSigner) issue(c Claims) (string, error) {
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	signed, err := t.SignedString(s.secret)
	if err != nil {
		return "", fmt.Errorf("auth: sign JWT: %w", err)
	}
	return signed, nil
}

// Parse validates the signature, expiry, issuer, and (if expectedPurpose is
// non-empty) the purpose claim. Returns the parsed claims on success.
func (s *JWTSigner) Parse(tokenStr, expectedPurpose string) (*Claims, error) {
	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(tokenStr, claims,
		func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("auth: unexpected signing method %v", t.Header["alg"])
			}
			return s.secret, nil
		},
		jwt.WithIssuer(jwtIssuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrJWTInvalid, err)
	}
	if !parsed.Valid {
		return nil, ErrJWTInvalid
	}
	if expectedPurpose != "" && claims.Purpose != expectedPurpose {
		return nil, fmt.Errorf("%w: got %q, want %q",
			ErrJWTWrongPurpose, claims.Purpose, expectedPurpose)
	}
	return claims, nil
}

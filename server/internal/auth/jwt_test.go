package auth

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

func newTestSigner(t *testing.T) *JWTSigner {
	t.Helper()
	s, err := NewJWTSigner(bytes.Repeat([]byte("k"), 32))
	if err != nil {
		t.Fatalf("NewJWTSigner: %v", err)
	}
	return s
}

func TestNewJWTSigner_RejectsShortSecret(t *testing.T) {
	for _, n := range []int{0, 1, 16, 31} {
		_, err := NewJWTSigner(make([]byte, n))
		if err == nil {
			t.Errorf("NewJWTSigner(len=%d) accepted; want error", n)
		}
	}
}

func TestIssueAccess_ParseRoundTrip(t *testing.T) {
	s := newTestSigner(t)
	tok, err := s.IssueAccess("user-uuid", "session-uuid", []string{"write", "read"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.Parse(tok, PurposeAccess)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if c.Subject != "user-uuid" {
		t.Errorf("Subject = %q, want %q", c.Subject, "user-uuid")
	}
	if c.ID != "session-uuid" {
		t.Errorf("JTI = %q, want %q", c.ID, "session-uuid")
	}
	if len(c.Roles) != 2 {
		t.Errorf("Roles len = %d, want 2", len(c.Roles))
	}
	if c.Issuer != jwtIssuer {
		t.Errorf("Issuer = %q, want %q", c.Issuer, jwtIssuer)
	}
}

func TestIssueTmp_PurposeBound(t *testing.T) {
	s := newTestSigner(t)
	tok, err := s.IssueTmp("user-uuid", PurposeTOTPEnroll)
	if err != nil {
		t.Fatal(err)
	}
	// Correct purpose passes
	if _, err := s.Parse(tok, PurposeTOTPEnroll); err != nil {
		t.Errorf("Parse(matching purpose): %v", err)
	}
	// Wrong expected purpose fails
	_, err = s.Parse(tok, PurposeAccess)
	if !errors.Is(err, ErrJWTWrongPurpose) {
		t.Errorf("Parse(wrong purpose): %v, want ErrJWTWrongPurpose", err)
	}
}

func TestIssueTmp_RejectsBadPurpose(t *testing.T) {
	s := newTestSigner(t)
	_, err := s.IssueTmp("user", "not-a-real-purpose")
	if err == nil {
		t.Error("IssueTmp accepted unknown purpose")
	}
}

func TestParse_ExpiredToken(t *testing.T) {
	s := newTestSigner(t)
	old := nowFn
	defer func() { nowFn = old }()

	// Issue 1 hour in the past with default 15min lifetime → expired.
	nowFn = func() time.Time { return time.Now().Add(-1 * time.Hour) }
	tok, err := s.IssueAccess("u", "sess", nil)
	if err != nil {
		t.Fatal(err)
	}
	// Parse at "real now"
	nowFn = time.Now
	_, err = s.Parse(tok, PurposeAccess)
	if !errors.Is(err, ErrJWTInvalid) {
		t.Errorf("Parse expired token: err = %v, want ErrJWTInvalid", err)
	}
}

func TestParse_WrongSignature(t *testing.T) {
	s1 := newTestSigner(t)
	s2, _ := NewJWTSigner(bytes.Repeat([]byte("X"), 32))
	tok, err := s1.IssueAccess("u", "sess", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s2.Parse(tok, PurposeAccess); !errors.Is(err, ErrJWTInvalid) {
		t.Errorf("cross-key Parse: err = %v, want ErrJWTInvalid", err)
	}
}

func TestParse_GarbageToken(t *testing.T) {
	s := newTestSigner(t)
	if _, err := s.Parse("not-a-jwt", PurposeAccess); !errors.Is(err, ErrJWTInvalid) {
		t.Errorf("err = %v, want ErrJWTInvalid", err)
	}
}

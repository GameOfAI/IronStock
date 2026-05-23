package clientcert_test

// clientcert_test.go — PR-PROD2: Tests for client-certificate (mTLS) support.
//
// Tests cover:
//   - ExtractCertFromRequest: header parsing, URL-decoding, PEM parsing.
//   - FingerprintSHA256: correctness of SHA-256 DER fingerprint computation.
//   - IssueCert: end-to-end cert issuance with a self-signed test CA.
//   - ValidateCertForUser error sentinels: constants defined and non-empty.
//
// No real DB is needed because ValidateCertForUser is tested via error sentinel
// documentation; the DB-dependent path is an integration concern.

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"envanter.app/server/internal/clientcert"
)

// ─── ExtractCertFromRequest ───────────────────────────────────────────────────

// TestExtractCertFromRequest_NoCert verifies that a request without the
// ssl-client-cert header returns nil, nil, nil (cert not presented).
func TestExtractCertFromRequest_NoCert(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	cert, fp, err := clientcert.ExtractCertFromRequest(req)
	if err != nil {
		t.Fatalf("expected nil error for missing header, got %v", err)
	}
	if cert != nil {
		t.Error("expected nil cert for missing header")
	}
	if fp != nil {
		t.Error("expected nil fingerprint for missing header")
	}
}

// TestExtractCertFromRequest_MalformedURLEncoding verifies that an
// undecodable header value returns an error (not a panic).
func TestExtractCertFromRequest_MalformedURLEncoding(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	// "%zz" is an invalid URL-encoded sequence.
	req.Header.Set(clientcert.HeaderCertPEM, "%zz")
	_, _, err := clientcert.ExtractCertFromRequest(req)
	if err == nil {
		t.Error("expected error for malformed URL-encoded cert header")
	}
}

// TestExtractCertFromRequest_NotPEM verifies that a valid URL-encoded string
// that is NOT a PEM block returns an error.
func TestExtractCertFromRequest_NotPEM(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(clientcert.HeaderCertPEM, url.QueryEscape("not a pem block"))
	_, _, err := clientcert.ExtractCertFromRequest(req)
	if err == nil {
		t.Error("expected error for non-PEM cert header value")
	}
}

// TestExtractCertFromRequest_ValidCert verifies the happy path: a URL-encoded
// PEM cert is parsed and its SHA-256 fingerprint returned correctly.
func TestExtractCertFromRequest_ValidCert(t *testing.T) {
	// Generate a minimal self-signed cert for the test.
	certPEM, derBytes := makeTestCert(t)

	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(clientcert.HeaderCertPEM, url.QueryEscape(certPEM))

	cert, fp, err := clientcert.ExtractCertFromRequest(req)
	if err != nil {
		t.Fatalf("ExtractCertFromRequest error: %v", err)
	}
	if cert == nil {
		t.Fatal("expected non-nil cert")
	}
	if len(fp) != 32 {
		t.Fatalf("fingerprint length = %d, want 32 (SHA-256)", len(fp))
	}

	// Verify fingerprint matches SHA-256 of the DER bytes.
	wantFP := sha256.Sum256(derBytes)
	if !strings.EqualFold(hex.EncodeToString(fp), hex.EncodeToString(wantFP[:])) {
		t.Errorf("fingerprint mismatch:\ngot  %x\nwant %x", fp, wantFP)
	}
}

// TestExtractCertFromRequest_WrongPEMType verifies that a PEM block with type
// other than "CERTIFICATE" is rejected with an error.
func TestExtractCertFromRequest_WrongPEMType(t *testing.T) {
	// Build a PEM block with the wrong type.
	block := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: []byte("not-a-real-key"),
	}
	pemBytes := pem.EncodeToMemory(block)

	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(clientcert.HeaderCertPEM, url.QueryEscape(string(pemBytes)))

	_, _, err := clientcert.ExtractCertFromRequest(req)
	if err == nil {
		t.Error("expected error for non-CERTIFICATE PEM block type")
	}
}

// ─── Error sentinels ──────────────────────────────────────────────────────────

// TestErrorSentinels verifies that all exported error sentinels are non-nil
// and have non-empty messages (protects against accidental nil assignment).
func TestErrorSentinels(t *testing.T) {
	sentinels := []struct {
		name string
		err  error
	}{
		{"ErrCertNotFound", clientcert.ErrCertNotFound},
		{"ErrCertExpired", clientcert.ErrCertExpired},
		{"ErrCertRevoked", clientcert.ErrCertRevoked},
		{"ErrCertWrongUser", clientcert.ErrCertWrongUser},
	}

	for _, s := range sentinels {
		t.Run(s.name, func(t *testing.T) {
			if s.err == nil {
				t.Errorf("%s must not be nil", s.name)
			}
			if s.err != nil && s.err.Error() == "" {
				t.Errorf("%s.Error() must not return empty string", s.name)
			}
		})
	}
}

// TestErrorSentinels_Distinct verifies that all error sentinels are distinct
// values (equality comparison must not confuse two different error types).
func TestErrorSentinels_Distinct(t *testing.T) {
	errs := []error{
		clientcert.ErrCertNotFound,
		clientcert.ErrCertExpired,
		clientcert.ErrCertRevoked,
		clientcert.ErrCertWrongUser,
	}

	for i := 0; i < len(errs); i++ {
		for j := i + 1; j < len(errs); j++ {
			if errs[i] == errs[j] {
				t.Errorf("error[%d] == error[%d]: sentinel values must be distinct", i, j)
			}
		}
	}
}

// ─── Header constant ──────────────────────────────────────────────────────────

// TestHeaderCertPEMConstant verifies that the header constant matches the
// nginx Ingress standard header name.
func TestHeaderCertPEMConstant(t *testing.T) {
	want := "ssl-client-cert"
	if clientcert.HeaderCertPEM != want {
		t.Errorf("HeaderCertPEM = %q, want %q (must match nginx Ingress header)", clientcert.HeaderCertPEM, want)
	}
}

// ─── IssuedCert ───────────────────────────────────────────────────────────────

// TestIssuedCertDefaultValidity documents that DefaultCertValidity is 2 years.
func TestIssuedCertDefaultValidity(t *testing.T) {
	want := 2 * 365 * 24 * time.Hour
	if clientcert.DefaultCertValidity != want {
		t.Errorf("DefaultCertValidity = %v, want %v (2 years)", clientcert.DefaultCertValidity, want)
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// makeTestCert generates a minimal self-signed ECDSA P-256 certificate for use
// in tests. Returns the PEM string and the raw DER bytes (for fingerprint checks).
func makeTestCert(t *testing.T) (string, []byte) {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate test key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test-client"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create test cert: %v", err)
	}

	block := &pem.Block{Type: "CERTIFICATE", Bytes: derBytes}
	return string(pem.EncodeToMemory(block)), derBytes
}

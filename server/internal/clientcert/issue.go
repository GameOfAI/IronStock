package clientcert

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"time"
)

const (
	// DefaultCertValidity is the leaf certificate validity period.
	DefaultCertValidity = 2 * 365 * 24 * time.Hour // 2 years
)

// IssuedCert is returned by IssueCert with the PEM-encoded cert + key,
// plus the fingerprint used to register it in the DB.
type IssuedCert struct {
	// CertPEM is the issued leaf certificate in PEM format.
	CertPEM string
	// KeyPEM is the private key in PEM format (PKCS#8 EC key).
	// Shown once to the admin; IronStock does NOT store this.
	KeyPEM string
	// FingerprintSHA256 is the hex-encoded SHA-256 of the DER certificate.
	// Stored in client_certificates for fast login lookup.
	FingerprintSHA256 string
	// FingerprintBytes is the raw 32-byte SHA-256 for DB storage.
	FingerprintBytes []byte
	// SerialNumber is the decimal string of the certificate serial.
	SerialNumber string
	// SubjectCN is the certificate Common Name (set to the username).
	SubjectCN string
	// NotBefore is the start of the validity window.
	NotBefore time.Time
	// NotAfter is the end of the validity window.
	NotAfter time.Time
}

// IssueCert generates a new ECDSA P-256 leaf certificate signed by the provided CA.
// The subject CN is set to subjectCN (typically the IronStock username).
// The private key is returned in the response and NEVER stored by the server.
func IssueCert(ca *CARecord, subjectCN string, validity time.Duration) (*IssuedCert, error) {
	if validity <= 0 {
		validity = DefaultCertValidity
	}

	// Load CA cert and key.
	caCert, err := ParseCACert(ca.CertPEM)
	if err != nil {
		return nil, fmt.Errorf("clientcert/issue: parse CA cert: %w", err)
	}
	caKey, err := x509.ParseECPrivateKey(ca.KeyDER)
	if err != nil {
		return nil, fmt.Errorf("clientcert/issue: parse CA key: %w", err)
	}

	// Generate leaf key.
	leafKey, err := ecdsa.GenerateKey(caKey.Curve, rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("clientcert/issue: generate leaf key: %w", err)
	}

	serial, err := randSerial()
	if err != nil {
		return nil, fmt.Errorf("clientcert/issue: generate serial: %w", err)
	}

	now := time.Now().UTC()
	notBefore := now.Add(-time.Minute)
	notAfter := now.Add(validity)

	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   subjectCN,
			Organization: []string{"IronStock"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
		IsCA:                  false,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		return nil, fmt.Errorf("clientcert/issue: sign leaf cert: %w", err)
	}

	// Fingerprint = SHA-256 of the DER-encoded certificate.
	fpRaw := sha256.Sum256(certDER)
	fpBytes := fpRaw[:]
	fpHex := hex.EncodeToString(fpBytes)

	// PEM encode cert.
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

	// PEM encode private key (PKCS#8 for broad compatibility).
	keyDER, err := x509.MarshalPKCS8PrivateKey(leafKey)
	if err != nil {
		return nil, fmt.Errorf("clientcert/issue: marshal leaf key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})

	return &IssuedCert{
		CertPEM:           string(certPEM),
		KeyPEM:            string(keyPEM),
		FingerprintSHA256: fpHex,
		FingerprintBytes:  fpBytes,
		SerialNumber:      serial.String(),
		SubjectCN:         subjectCN,
		NotBefore:         notBefore,
		NotAfter:          notAfter,
	}, nil
}

// FingerprintFromPEM parses a PEM-encoded certificate and returns its
// SHA-256 fingerprint as raw bytes. Used when registering external certs.
func FingerprintFromPEM(certPEM string) ([]byte, *x509.Certificate, error) {
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, nil, fmt.Errorf("clientcert: no CERTIFICATE PEM block found")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("clientcert: parse cert PEM: %w", err)
	}
	fp := sha256.Sum256(block.Bytes)
	return fp[:], cert, nil
}

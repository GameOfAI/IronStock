package clientcert

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"time"

	"envanter.app/server/internal/crypto"
)

const (
	builtinCAName = "IronStock Built-in CA"
	caAAD         = "client_cert_cas:builtin:private_key_enc"
	caValidity    = 20 * 365 * 24 * time.Hour // 20 years
)

// CARecord holds the data needed to issue leaf certificates from a built-in CA.
type CARecord struct {
	ID      string
	CertPEM string
	KeyDER  []byte // decrypted ECDSA private key in DER form
}

// EnsureBuiltinCA creates the IronStock built-in CA if it doesn't exist.
// Idempotent: if is_builtin=true already exists, this is a no-op.
func EnsureBuiltinCA(ctx context.Context, db DB, master *crypto.Cipher) error {
	// Check if a built-in CA already exists.
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM client_cert_cas WHERE is_builtin = true`).Scan(&count); err != nil {
		return fmt.Errorf("clientcert: check builtin ca: %w", err)
	}
	if count > 0 {
		return nil // already present
	}

	// Generate ECDSA P-256 key pair.
	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("clientcert: generate ca key: %w", err)
	}

	// Build self-signed CA certificate template.
	serial, err := randSerial()
	if err != nil {
		return fmt.Errorf("clientcert: generate serial: %w", err)
	}
	now := time.Now().UTC()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "IronStock Client Certificate Authority",
			Organization: []string{"IronStock"},
		},
		NotBefore:             now.Add(-time.Minute), // 1-minute skew tolerance
		NotAfter:              now.Add(caValidity),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &privKey.PublicKey, privKey)
	if err != nil {
		return fmt.Errorf("clientcert: sign ca cert: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

	// Marshal private key to DER, then encrypt with master key.
	privDER, err := x509.MarshalECPrivateKey(privKey)
	if err != nil {
		return fmt.Errorf("clientcert: marshal ca key: %w", err)
	}
	privEnc, err := master.Seal(privDER, []byte(caAAD))
	if err != nil {
		return fmt.Errorf("clientcert: encrypt ca key: %w", err)
	}

	_, err = db.Exec(ctx, `
		INSERT INTO client_cert_cas (name, cert_pem, private_key_enc, is_builtin)
		VALUES ($1, $2, $3, true)
	`, builtinCAName, string(certPEM), privEnc)
	if err != nil {
		return fmt.Errorf("clientcert: insert builtin ca: %w", err)
	}
	return nil
}

// LoadBuiltinCA fetches the built-in CA from the DB and decrypts its private key.
// Returns ErrNoCAFound if no built-in CA exists yet.
func LoadBuiltinCA(ctx context.Context, db DB, master *crypto.Cipher) (*CARecord, error) {
	var id, certPEM string
	var privEnc []byte
	err := db.QueryRow(ctx, `
		SELECT id::text, cert_pem, private_key_enc
		FROM client_cert_cas
		WHERE is_builtin = true
		LIMIT 1
	`).Scan(&id, &certPEM, &privEnc)
	if err != nil {
		return nil, ErrNoCAFound
	}

	privDER, err := master.Open(privEnc, []byte(caAAD))
	if err != nil {
		return nil, fmt.Errorf("clientcert: decrypt ca key: %w", err)
	}

	return &CARecord{ID: id, CertPEM: certPEM, KeyDER: privDER}, nil
}

// ParseCACert parses a PEM-encoded CA certificate and returns the x509.Certificate.
func ParseCACert(certPEM string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		return nil, fmt.Errorf("clientcert: no PEM block found in CA cert")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("clientcert: parse CA cert: %w", err)
	}
	return cert, nil
}

// randSerial generates a cryptographically random serial number for X.509.
func randSerial() (*big.Int, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("clientcert: rand serial: %w", err)
	}
	return new(big.Int).SetBytes(b), nil
}

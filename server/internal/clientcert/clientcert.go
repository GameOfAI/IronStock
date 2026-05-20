// Package clientcert implements client-certificate (mTLS) support for PR-SEC3.
//
// Architecture: IronStock uses nginx Ingress with auth-tls-verify-client="optional"
// to perform the TLS handshake. The Ingress forwards client certificate metadata
// as HTTP headers to the upstream application:
//
//	ssl-client-cert        URL-encoded PEM certificate
//	ssl-client-fingerprint SHA-1 fingerprint (informational)
//	ssl-client-subject-dn  Subject Distinguished Name
//
// The application extracts the PEM from ssl-client-cert, computes the SHA-256
// fingerprint itself (more secure than trusting the Ingress-supplied SHA-1), and
// looks it up in the client_certificates table.
//
// Two CA types are supported:
//  1. Built-in: IronStock generates the CA at startup (idempotent). The CA
//     private key is AES-256-GCM encrypted with the master key and stored in
//     client_cert_cas. Admin can issue leaf certs directly from the UI.
//  2. External: Admin uploads only the public CA cert PEM. The private key is
//     never stored. Admins register external leaf certs via PEM upload.
//
// DB tables: client_cert_cas, client_certificates, users.requires_client_cert.
package clientcert

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB is the minimal database interface needed by this package.
// *pgxpool.Pool satisfies it.
type DB = *pgxpool.Pool

// ErrCertNotFound is returned when no active registered cert matches the fingerprint.
var ErrCertNotFound = fmt.Errorf("clientcert: no active registered certificate found")

// ErrCertExpired is returned when the matching cert has passed not_after.
var ErrCertExpired = fmt.Errorf("clientcert: certificate is expired")

// ErrCertRevoked is returned when the matching cert has revoked_at set.
// (Normally filtered by the partial index, but checked explicitly for safety.)
var ErrCertRevoked = fmt.Errorf("clientcert: certificate has been revoked")

// ErrCertWrongUser is returned when the cert's user_id doesn't match the
// authenticating user — substitution attack guard.
var ErrCertWrongUser = fmt.Errorf("clientcert: certificate does not belong to this user")

// ErrNoCAFound is returned when no built-in CA exists yet.
var ErrNoCAFound = fmt.Errorf("clientcert: no built-in CA found")

// certRow is the internal DB row for client_certificates.
type certRow struct {
	ID                string
	UserID            string
	CAID              string
	FingerprintSHA256 []byte
	SubjectCN         string
	SerialNumber      string
	NotBefore         string
	NotAfter          string
	RevokedAt         *string
	Label             *string
	CreatedAt         string
}

// lookupByFingerprint fetches an active (non-revoked) cert row by fingerprint.
// Returns ErrCertNotFound if none exists.
func lookupByFingerprint(ctx context.Context, db DB, fingerprint []byte) (certRow, error) {
	const sqlText = `
		SELECT id::text, user_id::text, ca_id::text,
		       fingerprint_sha256, subject_cn, serial_number,
		       not_before::text, not_after::text,
		       revoked_at::text, label, created_at::text
		FROM client_certificates
		WHERE fingerprint_sha256 = $1
		LIMIT 1
	`
	var row certRow
	err := db.QueryRow(ctx, sqlText, fingerprint).Scan(
		&row.ID, &row.UserID, &row.CAID,
		&row.FingerprintSHA256, &row.SubjectCN, &row.SerialNumber,
		&row.NotBefore, &row.NotAfter,
		&row.RevokedAt, &row.Label, &row.CreatedAt,
	)
	if err != nil {
		return certRow{}, ErrCertNotFound
	}
	return row, nil
}

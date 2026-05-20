package clientcert

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// HeaderCertPEM is the nginx Ingress header that carries the client certificate
// (URL-encoded PEM) when auth-tls-pass-certificate-to-upstream is enabled.
const HeaderCertPEM = "ssl-client-cert"

// ExtractCertFromRequest reads the nginx ssl-client-cert header, URL-decodes it,
// parses the PEM certificate, and returns the cert + its SHA-256 fingerprint.
//
// Returns nil, nil, nil if no header is present (cert not presented at TLS level).
// Returns an error if the header is present but malformed.
func ExtractCertFromRequest(r *http.Request) (*x509.Certificate, []byte, error) {
	raw := r.Header.Get(HeaderCertPEM)
	if raw == "" {
		return nil, nil, nil // no client cert
	}

	// nginx URL-encodes the PEM before forwarding.
	decoded, err := url.QueryUnescape(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("clientcert: unescape ssl-client-cert header: %w", err)
	}

	block, _ := pem.Decode([]byte(decoded))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, nil, fmt.Errorf("clientcert: no CERTIFICATE block in ssl-client-cert header")
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("clientcert: parse cert from header: %w", err)
	}

	fp := sha256.Sum256(block.Bytes)
	return cert, fp[:], nil
}

// ValidateCertForUser verifies that the given fingerprint belongs to an active
// (non-revoked, non-expired) certificate registered for userID.
//
// Steps:
//  1. DB lookup by fingerprint (partial-index: revoked_at IS NULL).
//  2. Cross-check user_id matches the authenticating user (substitution guard).
//  3. Check not_after against wall clock.
func ValidateCertForUser(ctx context.Context, db DB, fingerprint []byte, userID string) error {
	row, err := lookupByFingerprint(ctx, db, fingerprint)
	if err != nil {
		return ErrCertNotFound
	}

	// Explicit revocation check (belt-and-suspenders over the partial index).
	if row.RevokedAt != nil {
		return ErrCertRevoked
	}

	// Cross-user substitution guard.
	if row.UserID != userID {
		return ErrCertWrongUser
	}

	// Expiry check.
	// not_after is stored as text in UTC by PostgreSQL::text. We parse it back.
	if row.NotAfter != "" {
		var notAfter time.Time
		// Try RFC3339 first (what pgx text-scans produce), then common fallbacks.
		parsed := false
		for _, layout := range []string{time.RFC3339, time.RFC3339Nano, "2006-01-02T15:04:05Z"} {
			if t, err := time.Parse(layout, row.NotAfter); err == nil {
				notAfter = t
				parsed = true
				break
			}
		}
		if parsed && time.Now().After(notAfter) {
			return ErrCertExpired
		}
	}

	return nil
}

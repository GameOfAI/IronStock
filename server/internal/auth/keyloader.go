// Package auth provides authentication and authorization primitives:
// master key bootstrap, password hashing, TOTP, JWT issuance, refresh
// tokens, and (PR-6+) middleware + RBAC.
package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrMasterKeyMismatch is returned when the env-provided master key does not
// match the active row in master_keys (fingerprint differs). This usually
// means the env key was rotated without following the proper procedure
// (ADR-0004 §8.1) — refusing to start protects existing data.
var ErrMasterKeyMismatch = errors.New("auth: master key fingerprint does not match active master_keys row")

// MasterKeyState is the resolved master key bookkeeping after BootstrapMasterKey.
type MasterKeyState struct {
	// ID is the master_keys.id of the active row (used by callers to set
	// foreign keys on items / totp_secrets / folders).
	ID int16
	// Version is the master_keys.version of the active row.
	Version int16
	// Key is the raw 32-byte key (callers pass to crypto.NewCipher).
	Key []byte
}

// fingerprint returns SHA-256(masterKey). Used as the persistent identity of a
// key in the master_keys table — the actual key bytes never enter the DB.
func fingerprint(masterKey []byte) []byte {
	h := sha256.Sum256(masterKey)
	return h[:]
}

// BootstrapMasterKey reconciles the env-supplied master key with the
// master_keys table.
//
//   - If no active row exists, inserts one (version=1, wrap_method='env',
//     wrapped_key=fingerprint).
//   - If exactly one active row exists with matching fingerprint, returns its id.
//   - If active row's fingerprint differs from env key → ErrMasterKeyMismatch.
//
// Rotation (active=false on old, insert new active=true) must happen via a
// dedicated procedure, not just by changing env. See ADR-0004 §8.1.
func BootstrapMasterKey(ctx context.Context, db *pgxpool.Pool, masterKey []byte) (MasterKeyState, error) {
	if len(masterKey) != 32 {
		return MasterKeyState{}, fmt.Errorf("auth: master key length = %d, want 32", len(masterKey))
	}
	fp := fingerprint(masterKey)

	tx, err := db.Begin(ctx)
	if err != nil {
		return MasterKeyState{}, fmt.Errorf("auth: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const selectSQL = `
		SELECT id, version, wrapped_key
		FROM master_keys
		WHERE active = true
		LIMIT 1
	`
	var (
		id      int16
		version int16
		stored  []byte
	)
	err = tx.QueryRow(ctx, selectSQL).Scan(&id, &version, &stored)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// First-time bootstrap: insert version=1 with this fingerprint.
		const insertSQL = `
			INSERT INTO master_keys (version, wrapped_key, wrap_method, active)
			VALUES (1, $1, 'env', true)
			RETURNING id, version
		`
		if err := tx.QueryRow(ctx, insertSQL, fp).Scan(&id, &version); err != nil {
			return MasterKeyState{}, fmt.Errorf("auth: insert master_keys: %w", err)
		}
	case err != nil:
		return MasterKeyState{}, fmt.Errorf("auth: select active master key: %w", err)
	default:
		if !bytesEqual(stored, fp) {
			return MasterKeyState{}, fmt.Errorf("%w (active id=%d version=%d)",
				ErrMasterKeyMismatch, id, version)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return MasterKeyState{}, fmt.Errorf("auth: commit tx: %w", err)
	}
	return MasterKeyState{ID: id, Version: version, Key: masterKey}, nil
}

// bytesEqual is a non-constant-time equality check used only on public
// fingerprints (no timing leak risk: fingerprints are not secrets).
func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

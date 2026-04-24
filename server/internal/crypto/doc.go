// Package crypto implements the server-side half of the envelope
// encryption scheme: master key loading from KMS/secret, per-item DEK
// generation, and AES-256-GCM encryption of metadata fields. Client-side
// E2E crypto for secret fields lives in the Tauri client — the server
// never sees those plaintexts. See docs/adr/0002-security-model.md.
package crypto

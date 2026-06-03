// Package webauthn wraps github.com/go-webauthn/webauthn to provide
// WebAuthn / FIDO2 registration and authentication for IronStock.
//
// Architecture:
//   - One WAService per server instance, configured from env vars at startup.
//   - Challenges (SessionData) are stored in an in-memory sync.Map with TTL.
//     PR-SCALE will move this to Redis for multi-replica deployments.
//   - Credentials are stored in user_webauthn_credentials (migration 00049).
package webauthn

import (
	"bytes"
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	gowa "github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Config holds configuration for the WebAuthn service.
type Config struct {
	// RPID is the Relying Party identifier — typically the domain (e.g. "ironstock.local").
	RPID string
	// RPDisplayName is the human-readable name shown in authenticator dialogs.
	RPDisplayName string
	// RPOrigins lists the allowed HTTP origins (e.g. "http://localhost:5173").
	RPOrigins []string
}

// WAService is the WebAuthn helper. Construct via New and reuse across requests.
type WAService struct {
	wa       *gowa.WebAuthn
	db       *pgxpool.Pool
	mu       sync.Mutex
	sessions map[string]sessionEntry
}

type sessionEntry struct {
	data      *gowa.SessionData
	expiresAt time.Time
}

const sessionTTL = 5 * time.Minute

// New constructs a WAService. Returns an error if the config is invalid.
func New(cfg Config, db *pgxpool.Pool) (*WAService, error) {
	if cfg.RPID == "" {
		return nil, fmt.Errorf("webauthn: RPID is required")
	}
	wa, err := gowa.New(&gowa.Config{
		RPID:          cfg.RPID,
		RPDisplayName: cfg.RPDisplayName,
		RPOrigins:     cfg.RPOrigins,
	})
	if err != nil {
		return nil, fmt.Errorf("webauthn: init: %w", err)
	}
	svc := &WAService{
		wa:       wa,
		db:       db,
		sessions: make(map[string]sessionEntry),
	}
	go svc.gcSessions()
	return svc, nil
}

// gcSessions periodically removes expired sessions from the in-memory map.
func (s *WAService) gcSessions() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		s.mu.Lock()
		for k, v := range s.sessions {
			if now.After(v.expiresAt) {
				delete(s.sessions, k)
			}
		}
		s.mu.Unlock()
	}
}

func (s *WAService) storeSession(key string, data *gowa.SessionData) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[key] = sessionEntry{data: data, expiresAt: time.Now().Add(sessionTTL)}
}

func (s *WAService) takeSession(key string) (*gowa.SessionData, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.sessions[key]
	if !ok || time.Now().After(e.expiresAt) {
		delete(s.sessions, key)
		return nil, false
	}
	delete(s.sessions, key)
	return e.data, true
}

// WAUser implements the webauthn.User interface backed by a DB user row.
type WAUser struct {
	ID          []byte
	Name        string
	DisplayName string
	Credentials []gowa.Credential
}

func (u *WAUser) WebAuthnID() []byte                     { return u.ID }
func (u *WAUser) WebAuthnName() string                   { return u.Name }
func (u *WAUser) WebAuthnDisplayName() string            { return u.DisplayName }
func (u *WAUser) WebAuthnCredentials() []gowa.Credential { return u.Credentials }
func (*WAUser) WebAuthnIcon() string                     { return "" }

// LoadUser fetches a user's WebAuthn credentials from the DB.
func (s *WAService) LoadUser(ctx context.Context, userID string, username string) (*WAUser, error) {
	rows, err := s.db.Query(ctx,
		`SELECT credential_id, public_key, sign_count, transports, uv_required
		 FROM user_webauthn_credentials
		 WHERE user_id = $1
		 ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("webauthn: load credentials: %w", err)
	}
	defer rows.Close()

	var creds []gowa.Credential
	for rows.Next() {
		var credID, pubKey []byte
		var signCount uint32
		var transports []string
		var uvRequired bool
		if err := rows.Scan(&credID, &pubKey, &signCount, &transports, &uvRequired); err != nil {
			return nil, fmt.Errorf("webauthn: scan credential: %w", err)
		}
		var auths []protocol.AuthenticatorTransport
		for _, t := range transports {
			auths = append(auths, protocol.AuthenticatorTransport(t))
		}
		creds = append(creds, gowa.Credential{
			ID:        credID,
			PublicKey: pubKey,
			Authenticator: gowa.Authenticator{
				SignCount: signCount,
			},
			Transport: auths,
			Flags: gowa.CredentialFlags{
				UserPresent:  true,
				UserVerified: uvRequired,
			},
		})
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}

	return &WAUser{
		ID:          []byte(userID),
		Name:        username,
		DisplayName: username,
		Credentials: creds,
	}, nil
}

// RegistrationOptions is what we send back to the client for /register/begin.
type RegistrationOptions struct {
	Options    interface{} `json:"options"`
	SessionKey string      `json:"session_key"`
}

// BeginRegistration creates a new registration challenge.
func (s *WAService) BeginRegistration(user *WAUser) (*protocol.CredentialCreation, string, error) {
	var excludeList []protocol.CredentialDescriptor
	for _, c := range user.Credentials {
		excludeList = append(excludeList, protocol.CredentialDescriptor{
			Type:         protocol.PublicKeyCredentialType,
			CredentialID: c.ID,
		})
	}
	options, sessionData, err := s.wa.BeginRegistration(user,
		gowa.WithExclusions(excludeList),
	)
	if err != nil {
		return nil, "", fmt.Errorf("webauthn: begin registration: %w", err)
	}
	key := fmt.Sprintf("reg:%s:%d", string(user.ID), time.Now().UnixNano())
	s.storeSession(key, sessionData)
	return options, key, nil
}

// FinishRegistration validates the authenticator response and returns the verified credential.
func (s *WAService) FinishRegistration(user *WAUser, sessionKey string, body []byte) (*gowa.Credential, error) {
	sessionData, ok := s.takeSession(sessionKey)
	if !ok {
		return nil, fmt.Errorf("webauthn: registration session not found or expired")
	}
	parsedResponse, err := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("webauthn: parse registration response: %w", err)
	}
	credential, err := s.wa.CreateCredential(user, *sessionData, parsedResponse)
	if err != nil {
		return nil, fmt.Errorf("webauthn: create credential: %w", err)
	}
	return credential, nil
}

// BeginLogin creates a login challenge for a user.
func (s *WAService) BeginLogin(user *WAUser) (*protocol.CredentialAssertion, string, error) {
	options, sessionData, err := s.wa.BeginLogin(user)
	if err != nil {
		return nil, "", fmt.Errorf("webauthn: begin login: %w", err)
	}
	key := fmt.Sprintf("login:%s:%d", string(user.ID), time.Now().UnixNano())
	s.storeSession(key, sessionData)
	return options, key, nil
}

// FinishLogin validates the authenticator assertion and returns the updated credential.
func (s *WAService) FinishLogin(user *WAUser, sessionKey string, body []byte) (*gowa.Credential, error) {
	sessionData, ok := s.takeSession(sessionKey)
	if !ok {
		return nil, fmt.Errorf("webauthn: login session not found or expired")
	}
	parsedResponse, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("webauthn: parse login response: %w", err)
	}
	credential, err := s.wa.ValidateLogin(user, *sessionData, parsedResponse)
	if err != nil {
		return nil, fmt.Errorf("webauthn: validate login: %w", err)
	}
	return credential, nil
}

// SaveCredential persists a new credential to the database.
func (s *WAService) SaveCredential(ctx context.Context, userID string, label string, cred *gowa.Credential) error {
	transports := make([]string, len(cred.Transport))
	for i, t := range cred.Transport {
		transports[i] = string(t)
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO user_webauthn_credentials
		 (user_id, credential_id, public_key, sign_count, transports, label, uv_required)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		userID,
		cred.ID,
		cred.PublicKey,
		cred.Authenticator.SignCount,
		transports,
		label,
		cred.Flags.UserVerified,
	)
	if err != nil {
		return fmt.Errorf("webauthn: save credential: %w", err)
	}
	return nil
}

// UpdateSignCount updates the sign counter after a successful login to prevent cloning.
func (s *WAService) UpdateSignCount(ctx context.Context, credentialID []byte, signCount uint32) error {
	_, err := s.db.Exec(ctx,
		`UPDATE user_webauthn_credentials
		 SET sign_count = $1, last_used_at = now()
		 WHERE credential_id = $2`,
		signCount, credentialID,
	)
	return err
}

// DeleteCredential removes a credential by its DB UUID for a specific user.
func (s *WAService) DeleteCredential(ctx context.Context, userID string, credDBID string) error {
	ct, err := s.db.Exec(ctx,
		`DELETE FROM user_webauthn_credentials WHERE id = $1 AND user_id = $2`,
		credDBID, userID,
	)
	if err != nil {
		return fmt.Errorf("webauthn: delete credential: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("webauthn: credential not found")
	}
	return nil
}

// ListCredentials returns the user's stored credential metadata (no sensitive material).
func (s *WAService) ListCredentials(ctx context.Context, userID string) ([]CredentialInfo, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, label, transports, created_at, last_used_at
		 FROM user_webauthn_credentials
		 WHERE user_id = $1
		 ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("webauthn: list credentials: %w", err)
	}
	defer rows.Close()

	var out []CredentialInfo
	for rows.Next() {
		var c CredentialInfo
		var lastUsed *time.Time
		if err := rows.Scan(&c.ID, &c.Label, &c.Transports, &c.CreatedAt, &lastUsed); err != nil {
			return nil, err
		}
		c.LastUsedAt = lastUsed
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpdateCredentialLabel renames a credential.
func (s *WAService) UpdateCredentialLabel(ctx context.Context, userID string, credID string, label string) error {
	ct, err := s.db.Exec(ctx,
		`UPDATE user_webauthn_credentials SET label = $1 WHERE id = $2 AND user_id = $3`,
		label, credID, userID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("webauthn: credential not found")
	}
	return nil
}

// CredentialInfo is the safe-to-expose credential metadata.
type CredentialInfo struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Transports []string   `json:"transports"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
}

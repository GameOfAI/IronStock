package auth

import (
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/crypto"
)

// Service is the dependency-bundle that auth-related HTTP handlers depend on.
// Constructed once at startup (cmd/api/main.go) and passed by reference.
type Service struct {
	DB         *pgxpool.Pool
	Master     *crypto.Cipher
	MasterKey  MasterKeyState
	JWT        *JWTSigner
	SearchKey  []byte
	IssuerName string // shown in TOTP authenticator apps ("Envanter")
}

// ServiceConfig is the constructor input for New.
type ServiceConfig struct {
	DB         *pgxpool.Pool
	MasterKey  MasterKeyState // resolved by BootstrapMasterKey
	JWTSecret  []byte
	IssuerName string
}

// New returns a fully wired Service. All inputs are required.
func New(cfg ServiceConfig) (*Service, error) {
	if cfg.DB == nil {
		return nil, errors.New("auth.New: DB is required")
	}
	if len(cfg.MasterKey.Key) != 32 {
		return nil, errors.New("auth.New: MasterKey.Key must be 32 bytes")
	}
	if cfg.IssuerName == "" {
		return nil, errors.New("auth.New: IssuerName is required")
	}
	master, err := crypto.NewCipher(cfg.MasterKey.Key)
	if err != nil {
		return nil, fmt.Errorf("auth.New: master cipher: %w", err)
	}
	signer, err := NewJWTSigner(cfg.JWTSecret)
	if err != nil {
		return nil, fmt.Errorf("auth.New: jwt signer: %w", err)
	}
	searchKey, err := crypto.DeriveSearchKey(cfg.MasterKey.Key, "envanter-search-v1")
	if err != nil {
		return nil, fmt.Errorf("auth.New: derive search key: %w", err)
	}
	return &Service{
		DB:         cfg.DB,
		Master:     master,
		MasterKey:  cfg.MasterKey,
		JWT:        signer,
		SearchKey:  searchKey,
		IssuerName: cfg.IssuerName,
	}, nil
}

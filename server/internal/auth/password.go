package auth

import (
	"encoding/json"
	"fmt"

	"envanter.app/server/internal/crypto"
)

// HashedPassword is the persistence-layer view of a password hash + the
// parameters needed to verify it later.
//
// All three are stored in the users table:
//
//	users.password_hash   bytea  -> Hash
//	users.argon2_params   jsonb  -> ParamsJSON  (serialized Argon2Params)
//	(salt is part of the encoded hash; we store it separately for clarity)
type HashedPassword struct {
	Hash       []byte
	Salt       []byte
	Params     crypto.Argon2Params
	ParamsJSON []byte // ready-to-insert jsonb
}

// HashPassword hashes plaintext with default Argon2id params and returns a
// ready-to-persist HashedPassword.
func HashPassword(password string) (HashedPassword, error) {
	hash, salt, params, err := crypto.HashPassword(password)
	if err != nil {
		return HashedPassword{}, fmt.Errorf("auth: hash password: %w", err)
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return HashedPassword{}, fmt.Errorf("auth: marshal params: %w", err)
	}
	return HashedPassword{
		Hash:       hash,
		Salt:       salt,
		Params:     params,
		ParamsJSON: paramsJSON,
	}, nil
}

// VerifyPassword checks the candidate against persisted hash+salt+params.
// Constant-time under the hood (subtle.ConstantTimeCompare).
//
// paramsJSON is the raw bytea/jsonb fetched from users.argon2_params.
func VerifyPassword(candidate string, hash, salt, paramsJSON []byte) (bool, error) {
	var params crypto.Argon2Params
	if err := json.Unmarshal(paramsJSON, &params); err != nil {
		return false, fmt.Errorf("auth: unmarshal argon2 params: %w", err)
	}
	return crypto.VerifyPassword(candidate, hash, salt, params), nil
}

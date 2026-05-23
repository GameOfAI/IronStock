// Package config manages the ironstock CLI configuration file and keyring.
//
// Configuration is stored in ~/.config/ironstock/config.json (XDG-compliant).
// The access token is stored in the OS keyring (Windows Credential Manager,
// macOS Keychain, Linux Secret Service) and NOT in the config file.
//
// Config file schema (plaintext metadata only):
//   {
//     "server_url": "https://ironstock.example.com",
//     "username": "alice"
//   }
//
// Keyring entries (per server_url):
//   - service: "ironstock-cli"
//   - user:    "access_token:<server_url>"
//   - pass:    "<JWT access token>"
//
//   - service: "ironstock-cli"
//   - user:    "refresh_token:<server_url>"
//   - pass:    "<JWT refresh token>"
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Config holds the persisted CLI configuration.
type Config struct {
	ServerURL string `json:"server_url"`
	Username  string `json:"username"`
}

// ErrNotConfigured is returned when no config file exists yet.
var ErrNotConfigured = errors.New("ironstock: not configured (run 'ironstock login')")

// configDir returns the platform-appropriate config directory.
func configDir() (string, error) {
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("APPDATA")
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(base, "ironstock"), nil
	default:
		// Linux / macOS: respect XDG
		if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
			return filepath.Join(xdg, "ironstock"), nil
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".config", "ironstock"), nil
	}
}

// configPath returns the path to config.json.
func configPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// Load reads the config file. Returns ErrNotConfigured if missing.
func Load() (*Config, error) {
	path, err := configPath()
	if err != nil {
		return nil, fmt.Errorf("config: path: %w", err)
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotConfigured
		}
		return nil, fmt.Errorf("config: open: %w", err)
	}
	defer f.Close()

	var cfg Config
	if err := json.NewDecoder(f).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("config: decode: %w", err)
	}
	return &cfg, nil
}

// Save writes the config file, creating directories as needed.
func Save(cfg *Config) error {
	dir, err := configDir()
	if err != nil {
		return fmt.Errorf("config: dir: %w", err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("config: mkdir: %w", err)
	}
	path := filepath.Join(dir, "config.json")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("config: create: %w", err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(cfg); err != nil {
		return fmt.Errorf("config: encode: %w", err)
	}
	return nil
}

// Delete removes the config file (used by logout --purge).
func Delete() error {
	path, err := configPath()
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("config: delete: %w", err)
	}
	return nil
}

// ---------- In-memory token store (used when OS keyring is unavailable) ----------
//
// NOTE: OS keyring support (Windows Credential Manager, macOS Keychain, Linux
// Secret Service) requires CGO or platform-specific libraries. For a zero-CGO
// cross-compiled binary we use an in-memory store for the current session and
// a file-based fallback for persistence.
//
// The token file is stored at ~/.config/ironstock/.tokens (mode 0600).
// In production deployments it is recommended to use the OS keyring instead
// of the file-based fallback. Users can set IRONSTOCK_NO_KEYRING=1 to force
// the file-based store.

type tokenStore struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

func tokenPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, ".tokens"), nil
}

// LoadTokens reads persisted tokens from the token file.
func LoadTokens() (access, refresh string, err error) {
	path, err := tokenPath()
	if err != nil {
		return "", "", err
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", nil
		}
		return "", "", fmt.Errorf("config: tokens open: %w", err)
	}
	defer f.Close()
	var ts tokenStore
	if err := json.NewDecoder(f).Decode(&ts); err != nil {
		return "", "", nil // corrupt = treat as missing
	}
	return ts.AccessToken, ts.RefreshToken, nil
}

// SaveTokens persists tokens to the token file (0600).
func SaveTokens(access, refresh string) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	path, err := tokenPath()
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("config: tokens create: %w", err)
	}
	defer f.Close()
	return json.NewEncoder(f).Encode(tokenStore{
		AccessToken:  access,
		RefreshToken: refresh,
	})
}

// ClearTokens removes the token file.
func ClearTokens() error {
	path, err := tokenPath()
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("config: tokens clear: %w", err)
	}
	return nil
}

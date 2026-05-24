# ironstock CLI

<p>
  <img src="https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white" alt="Go" />
  <img src="https://img.shields.io/badge/platforms-linux%20%7C%20macOS%20%7C%20windows-blue" alt="Platforms" />
  <img src="https://img.shields.io/badge/build-GoReleaser-orange?logo=go" alt="GoReleaser" />
</p>

Terminal access to your IronStock vault. A single statically-compiled Go binary with zero runtime dependencies.

---

## Installation

### Download Binary (recommended)

Download from [GitHub Releases](https://github.com/GameOfAI/IronStock/releases/latest):

```bash
# macOS (Apple Silicon)
curl -L https://github.com/GameOfAI/IronStock/releases/latest/download/ironstock_darwin_arm64.tar.gz | tar xz
sudo mv ironstock /usr/local/bin/

# macOS (Intel)
curl -L https://github.com/GameOfAI/IronStock/releases/latest/download/ironstock_darwin_amd64.tar.gz | tar xz
sudo mv ironstock /usr/local/bin/

# Linux (amd64)
curl -L https://github.com/GameOfAI/IronStock/releases/latest/download/ironstock_linux_amd64.tar.gz | tar xz
sudo mv ironstock /usr/local/bin/

# Linux (arm64)
curl -L https://github.com/GameOfAI/IronStock/releases/latest/download/ironstock_linux_arm64.tar.gz | tar xz
sudo mv ironstock /usr/local/bin/
```

```powershell
# Windows (PowerShell)
Invoke-WebRequest -Uri https://github.com/GameOfAI/IronStock/releases/latest/download/ironstock_windows_amd64.zip -OutFile ironstock.zip
Expand-Archive ironstock.zip -DestinationPath $env:LOCALAPPDATA\ironstock
# Add to PATH
```

### Build from Source

```bash
cd cli
go build -o ironstock .
```

---

## Quick Start

```bash
# Connect to your vault
ironstock login --server https://vault.example.com
# Enter username, password (and TOTP if enabled)

# Search for credentials
ironstock search "production database"

# Get a specific item
ironstock get <item-id>

# Copy a password to clipboard (auto-clears after 30s)
ironstock get <item-id> --field password --clip
```

---

## Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `login` | Authenticate with server | `--server` URL |
| `logout` | Revoke session and clear tokens | `--purge` clear local config |
| `get <id>` | Fetch a vault item | `--field` specific field, `--clip` clipboard with 30s auto-clear |
| `search <query>` | Search vault items | `--fuzzy` trigram search, `--json` JSON output |
| `list folders` | List all accessible folders | |
| `list items` | List items in a folder | |
| `create item` | Create a new vault item | |
| `update item` | Update an existing item | `--field key=value` |
| `relationship add` | Link two items | |
| `relationship list` | List item relationships | |
| `export` | Encrypted ZIP export (streaming) | |
| `version` | Show CLI version | |

---

## Authentication

The CLI stores credentials in a XDG-compliant directory:

```
~/.config/ironstock/
├── config.json     # Server URL and preferences
└── .tokens         # Access + refresh tokens (0600 permissions)
```

Token files are created with `0600` permissions (owner read/write only). The CLI automatically refreshes expired access tokens using the stored refresh token.

### Login with TOTP

```bash
ironstock login --server https://vault.example.com
# Username: admin
# Password: ********
# TOTP Code: 123456
# Successfully authenticated.
```

---

## Examples

### Search and Copy a Password

```bash
# Fuzzy search for items matching "prod"
ironstock search "prod" --fuzzy

# Get the password field and copy to clipboard
ironstock get 550e8400-e29b-41d4-a716-446655440000 --field password --clip
# Password copied to clipboard. Auto-clearing in 30 seconds.
```

### JSON Output for Scripting

```bash
# Get item as JSON for piping
ironstock search "api-key" --json | jq '.[0].name'

# Use in shell scripts
DB_PASS=$(ironstock get $ITEM_ID --field password)
```

### Encrypted Export

```bash
# Export entire vault as encrypted ZIP
ironstock export > vault-backup.zip
```

---

## Project Structure

```
cli/
├── main.go                    # Entry point
├── cmd/
│   ├── root.go                # Root command + global flags
│   ├── login.go               # Authentication
│   ├── logout.go              # Session revocation
│   ├── get.go                 # Fetch single item
│   ├── search.go              # Search items
│   ├── list.go                # List folders/items
│   ├── create.go              # Create item
│   ├── update.go              # Update item
│   ├── relationship.go        # Manage item links
│   ├── export.go              # Encrypted export
│   ├── version.go             # Version info
│   └── root_test.go           # Command tree tests
├── internal/
│   ├── config/                # XDG config + token storage
│   └── client/                # HTTP client with auto-refresh
├── go.mod
└── go.sum
```

---

## Testing

```bash
cd cli
go test ./...
```

**7 tests**: command tree validation, UUID detection, field value extraction (4 cases), global flags.

---

## Building

```bash
# Development build
cd cli && go build -o ironstock .

# Release build (via GoReleaser)
goreleaser release --snapshot --clean

# Cross-compile targets:
# - linux/amd64, linux/arm64
# - darwin/amd64, darwin/arm64
# - windows/amd64
# All builds use CGO_ENABLED=0 (static binary)
```

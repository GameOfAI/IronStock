# ironstock CLI

The `ironstock` CLI provides terminal access to your IronStock vault. It is a
statically-compiled Go binary — no runtime dependencies.

## Installation

### Download binary (recommended)

Download from [GitHub Releases](https://github.com/your-org/IronStock/releases):

```bash
# Linux (amd64)
curl -L https://github.com/your-org/IronStock/releases/latest/download/ironstock_linux_amd64.tar.gz | tar xz
sudo mv ironstock /usr/local/bin/

# macOS (Apple Silicon)
curl -L https://github.com/your-org/IronStock/releases/latest/download/ironstock_darwin_arm64.tar.gz | tar xz
sudo mv ironstock /usr/local/bin/
```

### Build from source

```bash
cd cli/
go build -ldflags "-X ironstock.app/cli/cmd.Version=$(git describe --tags)" -o ironstock .
```

## Quick Start

```bash
# 1. Log in
ironstock login --server https://ironstock.example.com

# 2. Search for items
ironstock search "production database"

# 3. Get an item's non-secret fields
ironstock get prod-db

# 4. Get a specific field value
ironstock get prod-db --field hostname

# 5. Copy a field to clipboard (auto-clears in 30 seconds)
ironstock get prod-db --field password --clip
```

## Authentication

Run `ironstock login` once. The server URL and username are saved to
`~/.config/ironstock/config.json`. Access and refresh tokens are stored in
`~/.config/ironstock/.tokens` (mode 0600).

TOTP is supported: if your account requires TOTP, you will be prompted after
entering your password.

**Important:** The master password (for E2E key derivation) is NOT saved. Only
non-secret field values are accessible from the CLI. Secret fields (passwords,
private keys, tokens) remain E2E-encrypted and must be decrypted using the
desktop client.

## Commands

| Command | Description |
|---------|-------------|
| `ironstock login` | Authenticate with the server |
| `ironstock logout` | Sign out and clear local tokens |
| `ironstock get <name>` | Get an item by name |
| `ironstock search <query>` | Search for items |
| `ironstock list folders` | List all accessible folders |
| `ironstock list items [folder-id]` | List items |
| `ironstock create item` | Create a new item |
| `ironstock update item <id>` | Update item metadata |
| `ironstock relationship add <src> <tgt>` | Add a relationship |
| `ironstock relationship list <id>` | List relationships |
| `ironstock export` | Export vault as ZIP (admin) |
| `ironstock version` | Print version |

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--quiet`, `-q` | Suppress headers (script-friendly) |
| `--config` | Custom config file path |

## Scripting Examples

```bash
# Get the hostname of an item (script-friendly)
HOST=$(ironstock get prod-db --field hostname --quiet)
ssh "admin@${HOST}"

# Export item ID for use in a pipeline
ITEM_ID=$(ironstock create item --name "Deploy Key" --type api_key \
  --folder "${FOLDER_ID}" --quiet)
echo "Created: ${ITEM_ID}"

# List all items as JSON and process with jq
ironstock list items --json | jq '.items[] | {name, id}'
```

## CI/CD Integration

```yaml
# GitHub Actions example
- name: Get server hostname
  env:
    IRONSTOCK_TOKEN: ${{ secrets.IRONSTOCK_API_TOKEN }}
  run: |
    # Use API token via Authorization header (no interactive login needed)
    HOST=$(curl -s -H "Authorization: Bearer $IRONSTOCK_TOKEN" \
      "https://ironstock.example.com/api/v1/items/search?q=prod-nginx&limit=1" \
      | jq -r '.items[0].fields[] | select(.field_def_key=="hostname") | .value_plain')
    echo "TARGET_HOST=${HOST}" >> $GITHUB_ENV
```

# IronStock Terraform Provider

<p>
  <img src="https://img.shields.io/badge/Terraform-%3E%3D1.0-7B42BC?logo=terraform&logoColor=white" alt="Terraform" />
  <img src="https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white" alt="Go" />
  <img src="https://img.shields.io/badge/Plugin_Framework-latest-7B42BC" alt="Plugin Framework" />
</p>

Manage your IronStock vault resources as infrastructure code. Create folders, items, and groups through Terraform.

---

## Usage

```hcl
terraform {
  required_providers {
    ironstock = {
      source = "GameOfAI/ironstock"
    }
  }
}

provider "ironstock" {
  url       = var.ironstock_url
  api_token = var.ironstock_api_token
}
```

### Create a Folder Hierarchy

```hcl
resource "ironstock_folder" "production" {
  name = "Production"
}

resource "ironstock_folder" "databases" {
  name      = "Databases"
  parent_id = ironstock_folder.production.id
}
```

### Store a Database Credential

```hcl
resource "ironstock_item" "postgres_prod" {
  name         = "PostgreSQL Production"
  folder_id    = ironstock_folder.databases.id
  item_type_id = 1

  fields = jsonencode([
    { key = "host",     value = "db.example.com" },
    { key = "port",     value = "5432" },
    { key = "username", value = "app_user" },
    { key = "password", value = var.db_password },
  ])

  tags = ["database", "production", "critical"]
}
```

### Create a Team Group

```hcl
resource "ironstock_group" "platform_team" {
  name        = "Platform Team"
  description = "Infrastructure and platform engineers"
}
```

### Use Variables for Sensitive Values

```hcl
variable "ironstock_url" {
  type    = string
  default = "https://vault.example.com"
}

variable "ironstock_api_token" {
  type      = string
  sensitive = true
}

variable "db_password" {
  type      = string
  sensitive = true
}
```

---

## Provider Configuration

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | IronStock API server URL |
| `api_token` | string | Yes | API token for authentication |

---

## Resources

### `ironstock_folder`

Manages vault folders for organizing credentials.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Folder name |
| `parent_id` | string | No | Parent folder UUID (omit for root) |
| `id` | string | Read-only | Folder UUID |

### `ironstock_item`

Manages vault items (credentials, secrets, configurations).

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Item name |
| `folder_id` | string | Yes | Parent folder UUID |
| `item_type_id` | number | Yes | Item type (1=Login, 2=Server, 3=Database, etc.) |
| `fields` | string (JSON) | No | JSON-encoded field array `[{key, value}]` |
| `tags` | list(string) | No | Tags for categorization |
| `notes` | string | No | Item notes |
| `id` | string | Read-only | Item UUID |

### `ironstock_group`

Manages user groups for access control.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Group name |
| `description` | string | No | Group description |
| `id` | string | Read-only | Group UUID |

---

## Authentication

Create an API token through the IronStock web UI or CLI:

```bash
# Via CLI
ironstock login --server https://vault.example.com
# Then create a token in the web UI: Profile → API Tokens → Create
```

Set the token via environment variable:

```bash
export IRONSTOCK_API_TOKEN="your-token-here"
export IRONSTOCK_URL="https://vault.example.com"
```

---

## Building from Source

```bash
cd terraform
go build -o terraform-provider-ironstock .
```

The provider is part of the IronStock monorepo and uses `go.work` for workspace management:

```
go.work
├── server/     # API server module
└── terraform/  # Provider module (this)
```

---

## Testing

```bash
cd terraform
go test ./...
```

**3 tests**: HTTP client header verification, request body handling, nil body support.

---

## Development

```bash
# Build and install locally
cd terraform
go build -o ~/.terraform.d/plugins/local/ironstock/ironstock/0.1.0/darwin_arm64/terraform-provider-ironstock .

# Use local provider
terraform {
  required_providers {
    ironstock = {
      source  = "local/ironstock/ironstock"
      version = "0.1.0"
    }
  }
}
```

# Terraform Provider

IronStock Terraform provider'ı, credential vault'u Infrastructure as Code (IaC) ile yönetmenizi sağlar. Klasör, item ve grup kaynakları desteklenir.

## Kurulum

```hcl
terraform {
  required_providers {
    ironstock = {
      source  = "gameofai/ironstock"
      version = "~> 0.1"
    }
  }
}
```

## Yapılandırma

```hcl
provider "ironstock" {
  url       = "https://ironstock.example.com"
  api_token = var.ironstock_token
}
```

| Parametre | Zorunlu | Açıklama |
|-----------|---------|----------|
| `url` | Evet | IronStock API URL'si |
| `api_token` | Evet | API token (scope: terraform) |

## Kaynaklar (Resources)

### ironstock_folder

```hcl
resource "ironstock_folder" "production" {
  name = "Production"
}

resource "ironstock_folder" "databases" {
  name      = "Databases"
  parent_id = ironstock_folder.production.id
}
```

| Attribute | Tip | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `name` | string | Evet | Klasör adı |
| `parent_id` | string | Hayır | Üst klasör UUID'si |
| `id` | string | Computed | Klasör UUID'si |

### ironstock_item

```hcl
resource "ironstock_item" "mysql_prod" {
  folder_id    = ironstock_folder.databases.id
  name         = "mysql-prod"
  item_type_id = 3
  description  = "Production MySQL"
}
```

| Attribute | Tip | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `folder_id` | string | Evet | Hedef klasör |
| `name` | string | Evet | Item adı |
| `item_type_id` | number | Hayır | Item tipi (1=Genel, 2=Sunucu, 3=Veritabanı) |
| `description` | string | Hayır | Açıklama |
| `id` | string | Computed | Item UUID'si |

### ironstock_group

```hcl
resource "ironstock_group" "devops" {
  name = "DevOps Team"
}
```

## Veri Kaynakları (Data Sources)

### data.ironstock_folder

```hcl
data "ironstock_folder" "existing" {
  id = "uuid-..."
}
output "folder_name" {
  value = data.ironstock_folder.existing.name
}
```

### data.ironstock_item

```hcl
data "ironstock_item" "lookup" {
  id = "uuid-..."
}
```

## Örnek: Tam Ortam Kurulumu

```hcl
# Klasör hiyerarşisi
resource "ironstock_folder" "prod" { name = "Production" }
resource "ironstock_folder" "staging" { name = "Staging" }
resource "ironstock_folder" "prod_db" {
  name      = "Databases"
  parent_id = ironstock_folder.prod.id
}

# Ekip grupları
resource "ironstock_group" "devops" { name = "DevOps" }
resource "ironstock_group" "dev" { name = "Developers" }

# Credential'lar
resource "ironstock_item" "pg_prod" {
  folder_id    = ironstock_folder.prod_db.id
  name         = "postgres-prod"
  item_type_id = 3
  description  = "PostgreSQL production master"
}
```

## Geliştirme

```bash
cd terraform/
go build -o terraform-provider-ironstock
```

Provider binary'sini `~/.terraform.d/plugins/` altına kopyalayın.

## Güvenlik Notları

- API token'ı `terraform.tfvars` yerine ortam değişkeni olarak geçirin
- State dosyasında item UUID'leri bulunur ama şifreli field değerleri saklanmaz
- Remote state backend (S3, Consul) kullanımı önerilir

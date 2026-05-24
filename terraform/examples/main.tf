terraform {
  required_providers {
    ironstock = {
      source  = "gameofai/ironstock"
      version = "~> 0.1"
    }
  }
}

variable "ironstock_url" {
  type    = string
  default = "http://localhost:8080"
}

variable "ironstock_token" {
  type      = string
  sensitive = true
}

provider "ironstock" {
  url       = var.ironstock_url
  api_token = var.ironstock_token
}

# --- Klasörler ---

resource "ironstock_folder" "production" {
  name = "Production"
}

resource "ironstock_folder" "staging" {
  name = "Staging"
}

resource "ironstock_folder" "prod_databases" {
  name      = "Databases"
  parent_id = ironstock_folder.production.id
}

# --- Gruplar ---

resource "ironstock_group" "devops" {
  name = "DevOps Team"
}

resource "ironstock_group" "developers" {
  name = "Developers"
}

# --- Item'lar ---

resource "ironstock_item" "mysql_prod" {
  folder_id    = ironstock_folder.prod_databases.id
  name         = "mysql-prod"
  item_type_id = 3 # Veritabanı
  description  = "Production MySQL ana sunucusu"
}

resource "ironstock_item" "redis_prod" {
  folder_id    = ironstock_folder.prod_databases.id
  name         = "redis-prod"
  item_type_id = 3
  description  = "Production Redis cluster"
}

# --- Data Sources ---

data "ironstock_folder" "existing" {
  id = ironstock_folder.production.id
}

data "ironstock_item" "lookup" {
  id = ironstock_item.mysql_prod.id
}

# --- Outputs ---

output "production_folder_id" {
  value = ironstock_folder.production.id
}

output "mysql_prod_item_id" {
  value = ironstock_item.mysql_prod.id
}

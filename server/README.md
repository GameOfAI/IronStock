# Server

Go 1.22 tabanlı REST + WebSocket API sunucusu.
PostgreSQL 16, envelope şifreleme, RBAC, audit log ve MinIO nesne depolama entegrasyonu içerir.

---

## Paket Mimarisi

```mermaid
graph TD
    main["cmd/api/main.go\ngraceful shutdown"]
    router["httpapi/router.go\nchi v5"]

    main --> router

    router --> mw_authn["middleware_authn\nJWT doğrulama"]
    router --> mw_rbac["middleware_rbac\nfolder-level yetki"]
    router --> mw_rl["middleware_ratelimit\ntoken bucket"]

    router --> auth_h["Auth Handlers\nlogin · logout · register\nTOTP · refresh · recover"]
    router --> folder_h["Folder Handlers\nCRUD · permissions"]
    router --> item_h["Item Handlers\nCRUD · shares · attachments"]
    router --> admin_h["Admin Handlers\nusers · audit log"]
    router --> ws_h["WS Handler\nWebSocket upgrade"]

    auth_h --> auth_pkg["internal/auth\nArgon2id · TOTP · JWT · session · lockout"]
    item_h --> crypto_pkg["internal/crypto\nAES-GCM envelope · X25519 sealedbox"]
    item_h --> storage_pkg["internal/storage\nMinIO Backend"]
    folder_h --> db_pkg["internal/db\npgx pool · sqlc queries"]
    admin_h --> audit_pkg["internal/audit\nappend-only log"]
    ws_h --> ws_pkg["internal/ws\nhub · events"]

    db_pkg --> pg[("PostgreSQL 16")]
    storage_pkg --> minio[("MinIO")]
```

---

## İstek Yaşam Döngüsü (Middleware Zinciri)

```mermaid
flowchart LR
    Req(["HTTP İsteği"]) --> RL["RateLimit\ntoken bucket\nIP bazlı"]
    RL --> Log["Logger\nistek/süre kaydı"]
    Log --> Authn{"JWT\nDoğrulama"}
    Authn -->|geçersiz| E401["401 Unauthorized"]
    Authn -->|geçerli| RBAC{"Folder\nRBAC"}
    RBAC -->|yetersiz| E403["403 Forbidden"]
    RBAC -->|yetki tamam| Handler["Handler\niş mantığı"]
    Handler --> DB[("PostgreSQL")]
    Handler --> WS["WS Hub\nbroadcast"]
    Handler --> Audit["Audit Log"]
    Handler -->|200| Resp(["HTTP Yanıt"])
```

---

## Internal Paketler

| Paket | Sorumluluk |
|-------|-----------|
| `auth` | Argon2id hash, TOTP (RFC 6238), JWT access/refresh, session, hesap kilitleme, recovery code |
| `crypto` | AES-256-GCM envelope şifreleme (metadata), X25519 sealed box (E2E key wrap), Argon2id KDF, arama hash'i |
| `db` | pgx/v5 bağlantı havuzu, sqlc üretilmiş sorgular, goose migration runner |
| `httpapi` | chi router, tüm handler'lar, 3 middleware katmanı (authn, RBAC, rate-limit), hata biçimlendirme |
| `ws` | WebSocket bağlantı hub'ı, olay tanımları, client yayın yönetimi |
| `audit` | Mutasyon olayları (auth, CRUD, permission) kayıt, server-side plaintext |
| `storage` | `Backend` arayüzü + `MinioBackend` (EnsureBucket, Put, Get, Delete, presign URL) |
| `config` | Ortam değişkeni tabanlı yapılandırma yükleme |
| `logging` | Yapılandırılmış loglama |
| `metrics` | Prometheus `/metrics` enstrümantasyonu |

---

## WebSocket Hub

```mermaid
graph TD
    subgraph hub["ws/hub.go"]
        reg["register chan"]
        unreg["unregister chan"]
        bcast["broadcast chan"]
        clients["clients map\nconn → user_id"]
    end

    API_h["item_handlers\nfolder_handlers"] -->|"ItemUpdated\nFolderDeleted\nShareChanged"| bcast
    bcast --> filt{"kullanıcı\nyetki filtresi"}
    filt -->|izinliyse| C1["Client 1\nWebSocket"]
    filt -->|izinliyse| C2["Client 2\nWebSocket"]
    filt -->|izinliyse| C3["Client N\nWebSocket"]

    C1 -->|connect| reg
    C1 -->|disconnect| unreg
```

---

## API Endpoint Özeti

```
POST   /auth/register           Kullanıcı kaydı
POST   /auth/login              Login → access + refresh token
POST   /auth/logout             Refresh token iptal
POST   /auth/refresh            Access token yenileme
POST   /auth/totp/enroll        TOTP kaydı başlat
POST   /auth/totp/verify        TOTP doğrulama + etkinleştirme
POST   /auth/change-password    Parola değiştirme
POST   /auth/recover            Recovery code ile parola sıfırlama

GET    /catalog/item-types      Item type tanımları
GET    /catalog/field-defs      Alan tanımları

GET    /folders                 Klasör ağacı
POST   /folders                 Yeni klasör
PATCH  /folders/:id             Klasör güncelle
DELETE /folders/:id             Klasör sil
GET    /folders/:id/permissions Klasör yetkileri
PUT    /folders/:id/permissions Klasör yetki güncelle

GET    /items?folder_id=        Item listesi
POST   /items                   Yeni item (şifreli field değerleriyle)
GET    /items/:id               Item detayı
PATCH  /items/:id               Item güncelle
DELETE /items/:id               Item sil
GET    /items/:id/shares        Item paylaşımları
PUT    /items/:id/shares        Item paylaşım güncelle

POST   /items/:id/attachments   Presigned upload URL al
GET    /items/:id/attachments   Ek listesi
GET    /items/:id/attachments/:aid  Presigned download URL al
DELETE /items/:id/attachments/:aid  Ek sil

GET    /admin/users             Kullanıcı listesi (admin)
PATCH  /admin/users/:id         Kullanıcı güncelle (admin)
POST   /admin/users/:id/disable Kullanıcıyı devre dışı bırak
GET    /admin/audit             Audit log (sayfalı)

GET    /healthz                 Sağlık kontrolü (k8s probe)
GET    /metrics                 Prometheus metrikleri
WS     /ws                      WebSocket bağlantısı
```

---

## Veritabanı Şeması (ER)

```mermaid
erDiagram
    users {
        uuid id PK
        text username
        text password_hash
        bytea public_key
        bytea private_key_enc
        bool totp_enabled
        bool disabled
    }
    sessions {
        uuid id PK
        uuid user_id FK
        text refresh_token_hash
        timestamptz expires_at
    }
    folders {
        uuid id PK
        uuid parent_id FK
        text name_enc
    }
    folder_permissions {
        uuid folder_id FK
        uuid user_id FK
        text role
    }
    items {
        uuid id PK
        uuid folder_id FK
        int item_type_id FK
        text name_enc
        bytea dek_wrapped
        bytea owner_dek_wrapped
    }
    item_fields {
        uuid item_id FK
        int field_definition_id FK
        int position
        bytea value_enc
        bytea value_nonce
    }
    item_shares {
        uuid item_id FK
        uuid user_id FK
        text role
        bytea dek_wrapped
    }
    item_attachments {
        uuid id PK
        uuid item_id FK
        text minio_key
        text mime_type
        bigint size_bytes
    }
    audit_log {
        uuid id PK
        uuid user_id FK
        text action
        text resource_type
        uuid resource_id
        timestamptz created_at
    }
    item_types {
        int id PK
        text label
        text key
    }
    field_definitions {
        int id PK
        int item_type_id FK
        text label
        text key
        bool is_secret
    }

    users ||--o{ sessions : "sahip olur"
    users ||--o{ folder_permissions : "alır"
    users ||--o{ item_shares : "paylaşılır"
    folders ||--o{ folders : "içerir (parent)"
    folders ||--o{ folder_permissions : "tanımlar"
    folders ||--o{ items : "barındırır"
    items ||--o{ item_fields : "içerir"
    items ||--o{ item_shares : "paylaşılır"
    items ||--o{ item_attachments : "taşır"
    item_types ||--o{ field_definitions : "şema tanımlar"
    item_types ||--o{ items : "tipler"
    field_definitions ||--o{ item_fields : "tanımlar"
    users ||--o{ audit_log : "üretir"
```

---

## Şifreleme Akışı

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant KV as Master Key (k8s Secret)
    participant DB as PostgreSQL

    Note over C,DB: Item oluşturma
    C->>C: Argon2id(master_password) → user_key
    C->>C: X25519 → private_key (user_key ile şifreli)
    C->>C: AES-256-GCM → secret_fields şifrele
    C->>S: POST /items {name, metadata, encrypted_fields, wrapped_dek}

    S->>KV: master_key al
    S->>S: AES-256-GCM → metadata şifrele (envelope)
    S->>DB: şifreli item + wrapped DEK kaydet

    Note over C,DB: Item okuma
    C->>S: GET /items/:id
    S->>DB: şifreli item al
    S->>KV: master_key ile metadata çöz
    S->>C: metadata (çözülmüş) + secret_fields (şifreli)
    C->>C: private_key → DEK unwrap → field çöz
```

---

## Migration Listesi

| No | Dosya | İçerik |
|----|-------|--------|
| 1 | `00001_init_extensions.sql` | pgcrypto extension + `set_updated_at()` trigger |
| 2 | `00002_users.sql` | Kullanıcı tablosu, Argon2id hash, durum, soft-lock |
| 3 | `00003_roles.sql` | Roller (read, write) + user_roles |
| 4 | `00004_sessions.sql` | Refresh token deposu |
| 5 | `00005_audit_log.sql` | Audit trail + BRIN index |
| 6 | `00006_master_keys.sql` | Server-side envelope master key metadata |
| 7 | `00007_user_keypairs.sql` | X25519 public/private key çiftleri |
| 8 | `00008_totp_secrets.sql` | TOTP gizli anahtarları |
| 9 | `00009_recovery_codes.sql` | Hesap kurtarma kodları |
| 10 | `00010_item_types.sql` | Item tipi tanımları |
| 11 | `00011_field_definitions.sql` | Alan şema tanımları |
| 12 | `00012_folders.sql` | Klasör ağacı (self-referential) |
| 13 | `00013_folder_permissions.sql` | Klasör × kullanıcı × rol |
| 14 | `00014_items.sql` | Envanter öğeleri (şifreli metadata + DEK) |
| 15 | `00015_item_fields.sql` | E2E şifreli alan değerleri |
| 16 | `00016_item_shares.sql` | Item paylaşımları (DEK wrap dahil) |
| 17 | `00017_item_relationships.sql` | Item'lar arası ilişkiler |
| 18 | `00018_item_description.sql` | Serbest metin açıklamaları |
| 19 | `00019_item_attachments.sql` | Dosya eki metadata (MinIO key, boyut, MIME) |

---

## Geliştirme

```bash
cd server

# Birim testleri
go test ./...

# Integration testleri (gerçek Postgres, testcontainers)
go test ./internal/db/... -tags integration -timeout 10m

# Lint
golangci-lint run

# Migrasyon uygula
goose -dir migrations postgres "$ENVANTER_DB_URL" up
```

Ortam değişkenleri için kök dizindeki `.env.example`'a bakın.

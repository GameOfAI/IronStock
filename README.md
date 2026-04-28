# Envanter App

[![CI](https://github.com/bhaslaman/Envanter_App/actions/workflows/ci.yml/badge.svg)](https://github.com/bhaslaman/Envanter_App/actions/workflows/ci.yml)

DevOps/SRE takımı için merkezi envanter ve credential yönetimi.
KeePassXC'ye alternatif — canlı sync, TOTP MFA, RBAC ve client-side E2E şifreleme.

**Durum:** `v1.0.0` — Production-ready. Tüm fazlar tamamlandı ✅

---

## Mimari Genel Bakış

```mermaid
graph TD
    subgraph clients["İstemciler"]
        TC["Tauri Desktop\n(Windows + macOS)"]
        WA["Admin Web UI\n(React)"]
    end

    subgraph server["Kubernetes Kümesi"]
        API["Go API Server\nREST + WebSocket"]
        PG[("PostgreSQL 16")]
        MN[("MinIO\nS3-compatible")]
    end

    TC -- "HTTPS + WSS" --> API
    WA -- "HTTPS + WSS" --> API
    API -- "pgx/v5" --> PG
    API -- "minio-go/v7" --> MN
```

---

## Şifreleme Sınırı

```mermaid
graph LR
    subgraph boundary["Şifreleme Sınırı"]
        subgraph client_zone["İstemci (kullanıcı cihazı)"]
            plain["Açık metin\n(kullanıcı görür)"]
            crypto_c["client/lib/crypto.ts\nArgon2id · X25519 · AES-GCM"]
        end

        subgraph server_zone["Sunucu (k8s)"]
            meta_enc["Metadata şifreli\n(AES-256-GCM envelope)"]
            secret_enc["Secret field'lar\nserver asla açık görmez"]
            audit["Audit log\nplaintext (uyumluluk)"]
            minio["MinIO\nbinary blob, içeriği bilmez"]
        end
    end

    plain -->|"Argon2id + X25519 wrap"| secret_enc
    plain -->|"server-side envelope"| meta_enc
    plain -->|"kim ne yaptı"| audit
    plain -->|"presigned URL, doğrudan"| minio
```

---

## İstek Yaşam Döngüsü

```mermaid
sequenceDiagram
    actor U as Kullanıcı
    participant TC as Tauri Client
    participant API as Go API
    participant PG as PostgreSQL
    participant MN as MinIO

    U->>TC: Parola gir
    TC->>TC: Argon2id → user_key
    TC->>API: POST /auth/login
    API->>PG: Argon2id doğrula
    API-->>TC: access_token + şifreli private_key
    TC->>TC: private_key çöz (RAM'de)

    U->>TC: Item seç
    TC->>API: GET /items/:id
    API->>PG: şifreli metadata + wrapped DEK
    API->>API: master_key → metadata çöz
    API-->>TC: metadata (açık) + secret_fields (şifreli)
    TC->>TC: private_key → DEK unwrap
    TC->>TC: DEK → field değerleri çöz
    TC-->>U: Tüm veriler gösterilir
```

---

## Özellikler

| Kategori | Özellik |
|----------|---------|
| **Auth** | Username + Argon2id, TOTP (RFC 6238), JWT access/refresh |
| **Yetkilendirme** | Folder-level RBAC — `read` / `write` rolleri |
| **Şifreleme** | Metadata → server-side AES-256-GCM envelope; Secret field → client-side X25519 E2E |
| **Paylaşım** | Per-item DEK, yetkili kullanıcıların public key'iyle wrap |
| **Live Sync** | WebSocket hub — anlık item/folder değişiklik bildirimi |
| **Offline Cache** | Client bağlantısı koparsa son veriye şifreli erişim |
| **Dosya Ekleri** | MinIO presigned URL upload/download — server plaintext görmez |
| **Audit Log** | Tüm mutasyonlar server-side plaintext kaydı |
| **Metrikler** | Prometheus `/metrics` endpoint |

---

## Dizin Yapısı

```
├── server/          # Go backend — REST + WebSocket + şifreleme
├── client/          # Tauri desktop app (Windows + macOS)
├── web/             # React admin web UI
├── shared/          # OpenAPI spec + oluşturulan TypeScript tipleri
├── deploy/
│   ├── k8s/         # Kubernetes manifests + Kustomize
│   └── compose/     # Docker Compose (local dev)
└── docs/
    └── adr/         # Architecture Decision Records (0001–0007)
```

Her katmanın ayrıntılı belgesi ilgili dizindeki `README.md`'dedir:
[server/README.md](server/README.md) · [client/README.md](client/README.md) · [web/README.md](web/README.md) · [deploy/README.md](deploy/README.md)

---

## Hızlı Başlangıç (Geliştirici)

Gereksinimler: **Docker**, **Go 1.22+**, **Node 20+**, **Rust 1.75+**

```bash
# 1. Dev stack başlat (Postgres + MinIO + Adminer + Mailhog)
make up

# 2. Migrasyonları uygula
make migrate

# 3. Server'ı çalıştır
make run

# 4. Admin Web UI (ayrı terminal)
cd web && npm run dev

# 5. Desktop client (ayrı terminal)
cd client && npm run tauri:dev
```

Tüm komutlar için: `make help`

---

## Güvenlik Modeli (Özet)

```
Metadata (isim, IP, hostname)   → Server-side envelope encryption (AES-256-GCM)
Secret field (parola, token)    → Client-side E2E (Argon2id KDF + X25519 wrap)
Audit log                       → Server-side plaintext (uyumluluk için)
Attachments                     → MinIO presigned URL — server plaintext görmez
```

Detay: [docs/adr/0002-security-model.md](docs/adr/0002-security-model.md)

---

## CI/CD

| Tetikleyici | Çalışan Job'lar |
|-------------|----------------|
| PR → main | Server (lint+test+build), Web (lint+test+build), Client (TS check), Integration tests |
| Push → main | + Docker Build & Push (GHCR), Kustomize image tag update |
| Push `v*` tag | + Tauri binary (Win NSIS + macOS Universal DMG), GitHub Release |

Container registry: `ghcr.io/gameofai/envanter-api` / `envanter-web`

---

## Dokümantasyon

| Dosya | İçerik |
|-------|--------|
| [PROGRESS.md](PROGRESS.md) | Faz durumu + geliştirme günlüğü |
| [RULES.md](RULES.md) | Kod, commit ve test kuralları |
| [TODO.md](TODO.md) | Tamamlanan ve planlanan task'lar |
| [docs/adr/0001](docs/adr/0001-tech-stack.md) | Tech stack kararı |
| [docs/adr/0002](docs/adr/0002-security-model.md) | Hibrit şifreleme modeli |
| [docs/adr/0003](docs/adr/0003-repo-layout.md) | Monorepo yapısı |

---

## Lisans

Proprietary — internal project.

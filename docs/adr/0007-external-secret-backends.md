# 0007 — External Secret Backends (Vault Proxy Modeli)

- **Durum:** Accepted (Faz 5+ implementation)
- **Tarih:** 2026-04-24
- **Karar veren:** Burak Haşlaman (DevOps/SRE)
- **İlgili ADR:** [0002](0002-security-model.md), [0004](0004-encryption-details.md), [0006](0006-data-model-extensions.md)

## Bağlam

Takım HashiCorp Vault'u k8s ortamında **mevcut ve canlı** secret yönetim sistemi olarak kullanıyor. Envanter App'in Vault'u **değiştirmek** yerine **üzerine değer katan UI katmanı** olması isteniyor.

Tipik senaryo:
- Bazı secret'lar (örn: prod DB parolası) Vault'ta yaşıyor.
- Takım bu secret'a erişmek için Vault UI'sına gitmek zorunda kalıyor → UX parçalı.
- Envanter envanterinde "Prod DB - ProjeA" item'ı var; yanında secret da varmış gibi görünsün, ama **aslında Vault'tan** gelsin.

Gerilim: ADR-0002/0004'teki E2E tasarımı, Envanter server'ın secret plaintext'ini asla görmemesini şart koşuyor. Vault'tan secret çekerken bu kural nasıl korunur?

## Karar

### Model: **Proxy (Option A)**

Envanter Vault'tan secret'ları **mirror'lamaz, senkronize tutmaz, DB'ye yazmaz**. Sadece **path referansını** tutar; her kullanıcı isteği geldiğinde Vault'tan **canlı çeker**, RAM'de passthrough yapar, client'a iletir.

```
Client UI             Envanter Server         HashiCorp Vault
    │                       │                        │
    │ "bu password'u göster"│                        │
    ├──────────────────────▶│                        │
    │                       │  GET /vault/v1/secret/data/...
    │                       │  (user'ın Vault token'ı ile)
    │                       ├───────────────────────▶│
    │                       │                        │
    │                       │  200 {data: {password: "..."}}
    │                       │◀───────────────────────┤
    │                       │                        │
    │  {value: "..."}       │ (DB'ye YAZMAZ, memory passthrough)
    │◀──────────────────────┤                        │
    │                       │                        │
    │ UI'da 30sn göster /   │                        │
    │ clipboard + auto-clear│                        │
```

### Schema Etki: `items.external_source`

ADR-0006'da tanımlandı. Kolon yapısı:

```jsonc
items.external_source = {
  "type": "vault",
  "mount": "secret",            // Vault mount path (v1 vs v2 kv farkı için)
  "path": "projeA/db-prod",     // Vault path (mount'tan sonrası)
  "key_mapping": {              // Envanter field → Vault key
    "password": "password",      // field_definition.key → vault data key
    "connection_string": "conn_str"
  }
}
```

`external_source = NULL` → native item (Envanter'da yaşar, mevcut E2E/envelope davranışı).
`external_source` dolu → hybrid item (metadata Envanter'da, secret'lar Vault'ta).

### Item Field Davranışı

`item_fields.value_enc` kolonu **nullable** (ADR-0006'da tanımlandı).

```
field_definitions.is_secret | value_enc state  | Davranış
----------------------------|------------------|-----------------------------------------
true  (password/key)        | NULL             | external_source.key_mapping'ten çekilir
true                        | dolu             | Native E2E (client decrypt) — mevcut
false (hostname/ip)         | NULL             | external_source'tan çekilir (read-only)
false                       | dolu             | Native envelope (server decrypt) — mevcut
```

### Vault Auth Modeli

| Model | Nasıl çalışır | Önerilen |
|-------|---------------|----------|
| **Per-user Vault token** | Envanter kullanıcısı ayrıca Vault'a login, token Envanter'a verilir (encrypted storage veya session binding) | Güvenlik için ideal; 2 login dezavantajı |
| **Kubernetes auth (app)** | Envanter pod'un Service Account'u Vault'ta AppRole yetkili. Tüm kullanıcılar Envanter üzerinden Vault'a tek kimlikle çıkar | **MVP için seçim.** Envanter RBAC'ı ile yetkilendirme; Vault audit log'unda her şey "envanter" olarak görünür, **ama Envanter'ın kendi audit_log'u** kim ne çekti diye logluyor |
| **OIDC SSO** | Envanter ve Vault aynı kimlik sağlayıcısından (Azure AD, Okta) token alır, seamless | Post-MVP (Parking Lot). İdeal uzun vadede |

**Seçim (MVP/Faz 5):** **Kubernetes auth + Envanter kendi audit_log'u**. Vault için tek AppRole, Envanter içindeki RBAC + audit asıl yetkilendirme ve denetim katmanı.

### Dynamic Secrets (Bonus Özellik)

Vault'un en güçlü yanı: dynamic secrets. Envanter bunu expose edebilir:

```
Item: "Prod DB - ProjeA"
├── Field'lar: host, port, db_name, ...
└── Dynamic actions:
    └── [🔑 "15dk kısa ömürlü cred al"] butonu
         ↓
    Envanter → Vault: POST database/creds/projeA-prod-reader
         ↓
    Vault: Yeni DB user yaratır, {user, pass, lease_id, lease_duration: 900}
         ↓
    Envanter → Client: Bu bilgileri göster
         ↓
    Kullanıcı pgAdmin'i açar, kullanır. 15dk sonra Vault user'ı auto-revoke.
```

Faz 5+'te değerlendirilecek. Dynamic secrets için Vault policy tarafı önceden hazırlanmalı.

### Item Linking (Manuel-Only, MVP)

**Auto-discovery KAPSAM DIŞI.** Sebep:
- Vault path pattern'leri ↔ Envanter folder düzeni arasında 1:1 eşleme nadiren doğal.
- Proje içinde env farklılığı (prod/stage/test/lab) vs Vault path konvansiyonu tutarsızlık kaynağı.
- Manuel link, UX ve doğruluk açısından daha güvenli.

**Akış (MVP):**
1. Item oluşturma form'unda "Kaynak: Vault" seçeneği işaretlenir.
2. Path gir (autocomplete ile Vault'tan path listesi çekilebilir, ama seçim manuel).
3. Hangi field'ların hangi Vault key'inden geleceği seç (key_mapping formu).
4. Save → `items.external_source` doldurulur.

### Logging & Audit

- **Vault fetch her isteği Envanter audit_log'una yazılır:**
  ```
  action: "item.external_fetch"
  resource_type: "item"
  resource_id: item.id
  details: {"source":"vault","path":"projeA/db-prod","field":"password","success":true}
  ```
- Vault plaintext **asla** log'lanmaz (detail içinde sadece metadata).
- Vault'a erişim hatası (403, path yok vs) audit'e alınır.

## Alternatifler

### B) Senkronizasyon (mirror) Modeli
- Job Vault'tan periyodik çeker, Envanter'a re-encrypt ederek yazar.
- **Reddedildi:**
  - Re-encrypt için server'ın plaintext görmesi gerek → E2E modeli bozulur.
  - Eğer client re-encrypt ederse: sync için client online olmalı, impractical.
  - Vault değişince mirror bayat kalır, tutarlılık kaybı.

### C) Sadece Link (user Vault'a yönlendirilir)
- Envanter "Vault'a git →" link'i gösterir, kullanıcı Vault UI'sına gider.
- **Reddedildi:** Tek-UI deneyimi kaybolur; kullanıcı iki farklı UI öğrenmek zorunda; Envanter sadece bookmark manager seviyesinde değer katar.

### D) Auto-discovery (MVP'de ret)
- Envanter Vault path'lerini polling ile tarar, otomatik item shell oluşturur.
- **Reddedildi (MVP):** İsim pattern farkı. Parking Lot'ta.

## Sonuçlar

### Olumlu
- **Tek UI** — kullanıcı Envanter'dan hiç çıkmaz.
- **E2E/envelope modeli bozulmaz** — Vault secret'ı DB'ye asla yazılmaz.
- **Source of truth** Vault olarak kalır — duplicate yok, sync bayatlığı yok.
- **Dynamic secrets** DevOps workflow'u için büyük kazanım.
- **Hybrid envanter** — aynı ağaçta hem native item'lar hem Vault-backed item'lar.

### Olumsuz / Risk
- **Vault erişimi olmadan Envanter kısıtlı** — Vault down olursa Vault-backed item'lar görüntülenemez (ama native item'lar etkilenmez).
- **Network latency** — her secret erişimi bir RTT. Cache eklenirse güvenlik karmaşıklığı artar; **cache yok** kararı.
- **Vault policy yönetimi** — Envanter k8s AppRole policy'si Vault admin ile koordineli tutulmalı.
- **Audit çift yönlü** — Envanter audit_log'unda görünür, Vault audit'te "envanter" servisiyle görünür. Korelasyon için request-id log'lanır.

### Nötr
- Faz 5'e kadar sadece şema tarafı (`items.external_source` kolonu) hazırlanır; kullanılmaz.
- Vault haricinde başka backend'ler (AWS Secrets Manager, Azure Key Vault) aynı modele genişletilebilir. `external_source.type = "aws_sm" | "azure_kv" | ...`.

## Faz Sorumlulukları

| Faz | İş |
|-----|-----|
| **Faz 2** | Migration: `items.external_source jsonb` kolonu eklenir, `item_fields.value_enc` nullable yapılır |
| **Faz 5** | Vault HTTP client (Go) + k8s AppRole auth (`server/internal/vault`) |
| **Faz 5** | Item detail endpoint'ini genişlet: `external_source` doluysa Vault'tan passthrough |
| **Faz 5** | Admin UI (web + client): "Vault-backed item oluştur" formu, key_mapping editor |
| **Faz 5** | Dynamic secrets flow (opsiyonel): "kısa ömürlü cred al" endpoint'i |
| **Faz 5** | Audit log entegrasyonu: her Vault fetch log'lanır |
| **Parking Lot** | Auto-discovery polling (watched paths) |
| **Parking Lot** | AWS Secrets Manager / Azure Key Vault support |
| **Parking Lot** | OIDC SSO (Vault + Envanter ortak kimlik) |

## Referanslar

- HashiCorp Vault Docs — Kubernetes auth method: https://developer.hashicorp.com/vault/docs/auth/kubernetes
- Vault KV v2 API: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
- Dynamic Database Secrets: https://developer.hashicorp.com/vault/docs/secrets/databases

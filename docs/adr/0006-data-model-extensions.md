# 0006 — Veri Modeli Genişlemeleri

- **Durum:** Accepted
- **Tarih:** 2026-04-24
- **Karar veren:** Burak Haşlaman (DevOps/SRE)
- **Etkilediği ADR'ler:** [0002](0002-security-model.md), [0004](0004-encryption-details.md)

## Bağlam

Faz 1 tasarım görüşmelerinde şu ürün gereksinimleri somutlaştı:

1. **Objeler arası link** — "ProjeA'nın DB'si, sunucu X üzerinde çalışıyor" gibi tipli ilişkiler.
2. **Dinamik field'lar** — server item'ında hostname, ip, 2 farklı disk, root_password gibi; kullanıcı istediğinde yeni field ekleyebilir.
3. **Alan isim standartı** — "hostname" mi "host_name" mi kaosunu önlemek için merkezi field dictionary.
4. **3-katmanlı yetkilendirme** — Global rol (admin/write/read) + klasör-level ACL + item-level share.
5. **Item tipleri** — server/url/database/ssh_key/note/generic gibi kategoriler; her tipin önerilen field set'i olacak.
6. **External secret kaynağı** — Vault gibi dış sistemlerden secret çekebilmek (detay ADR-0007).

Bu ADR, bunları destekleyecek şema eklentilerini tanımlar. İlgili kararlar ADR-0002/0004'ü bozmaz, üstüne bina eder.

## Karar

### 1. `item_types` — Item Kategorileri (ayrı tablo)

```sql
CREATE TABLE item_types (
    id                 smallint    PRIMARY KEY,
    key                text        NOT NULL UNIQUE,
    label              text        NOT NULL,
    icon               text,       -- UI icon adı (lucide-react vs)
    suggested_fields   jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- ↑ field_definitions.key array: ["hostname","ip_address","port","username","password"]
    default_launchers  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- ↑ Faz 4 client feature için: [{"label":"SSH","command":"ssh {username}@{hostname}"}]
    created_by         uuid,       -- null=sistem seed
    created_at         timestamptz NOT NULL DEFAULT now()
);
```

**Seed tipler:**

| id | key | Önerilen field'lar |
|----|-----|---------------------|
| 1 | `server` | hostname, ip_address, ssh_port, username, password, root_password, os, cpu, ram_gb, disk_gb, environment |
| 2 | `url` | url, username, password, notes, environment |
| 3 | `database` | host, port, db_name, db_type, username, password, environment |
| 4 | `ssh_key` | hostname, username, ssh_private_key, ssh_passphrase, fingerprint |
| 5 | `certificate` | hostname, cert_pem, private_key, expires_at, issuer |
| 6 | `cloud_credential` | provider, access_key, secret_key, region, account_id |
| 7 | `note` | notes |
| 8 | `generic` | — (serbest) |

**Neden tablo, enum değil?**
- Admin UI'dan yeni tip eklenebilir, migration gerekmez.
- Her tipin icon/label/suggested_fields metadata'sı var — jsonb'de saklamak enum ile sıkıştırılamaz.

### 2. `field_definitions` — Merkezi Field Sözlüğü

```sql
CREATE TABLE field_definitions (
    id                 bigserial   PRIMARY KEY,
    key                text        NOT NULL UNIQUE,  -- lowercase_snake_case normalize
    label              text        NOT NULL,
    field_type         text        NOT NULL
        CHECK (field_type IN ('text','password','url','number','boolean','multiline','ip','port','email','ssh_key','enum')),
    allowed_values     jsonb,       -- field_type='enum' için; diğerlerinde NULL
    is_secret          boolean     NOT NULL,
    -- ↑ true → item_fields.value_enc E2E (client-encrypted)
    -- ↑ false → item_fields.value_enc server-envelope
    hint               text,
    validation_regex   text,
    created_by         uuid,
    created_at         timestamptz NOT NULL DEFAULT now()
);
```

**Seed tanımları (başlangıç):**

| key | field_type | is_secret | Not |
|-----|-----------|-----------|-----|
| `hostname` | text | false | FQDN veya kısa ad |
| `ip_address` | ip | false | IPv4/IPv6 |
| `port` | port | false | 1-65535 |
| `username` | text | false | |
| `password` | password | **true** | |
| `root_password` | password | **true** | |
| `ssh_port` | port | false | default 22 |
| `ssh_private_key` | ssh_key | **true** | PEM |
| `ssh_passphrase` | password | **true** | |
| `url` | url | false | |
| `db_name` | text | false | |
| `db_type` | enum | false | allowed_values=`["postgres","mysql","mongo","redis","mssql","oracle","elasticsearch"]` |
| `host` | text | false | DB/URL bileşeni için |
| `cpu` | text | false | "8 vCPU / Intel Xeon" |
| `ram_gb` | number | false | |
| `disk_gb` | number | false | toplam veya tek disk |
| `os` | text | false | "Ubuntu 22.04" |
| `environment` | enum | false | allowed_values=`["prod","stage","test","dev","lab"]` |
| `criticality` | enum | false | allowed_values=`["critical","high","medium","low"]` |
| `notes` | multiline | false | |

**Etki: `item_fields` şeması değişti**
```sql
-- önceki: is_secret ve key item_fields içindeydi
-- yeni: sadece field_definition_id taşır, tip bilgisi ordan gelir
CREATE TABLE item_fields (
    id                     uuid        PRIMARY KEY,
    item_id                uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    field_definition_id    bigint      NOT NULL REFERENCES field_definitions(id),
    value_enc              bytea,       -- NULL ise değer external_source'dan gelir
    value_nonce            bytea,
    position               int         NOT NULL DEFAULT 0,
    UNIQUE (item_id, field_definition_id)  -- aynı field iki kere eklenemez
);
```

**UI davranışı:**
- Item oluşturma formunda "field ekle" butonu type-to-search autocomplete açar.
- Mevcut tanım bulunursa seç; bulunmazsa "Yeni tanım oluştur: `{girdiğin_ad}` (tip: ?)" seçeneği çıkar.
- Admin yeni tanım oluşturunca o tanım herkes için globalce kullanılabilir.

**Aynı field'ı custom type olarak kullanmak isteyenler için:** Unique constraint `(item_id, field_definition_id)` var; ama `hostname` aynı item'da iki kere gerekmez (genelde). İhtiyaç olursa tanımı `hostname_backup` gibi yeni key ile yaratabilir.

### 3. `folder_permissions` — Klasör-Level ACL

```sql
CREATE TABLE folder_permissions (
    folder_id             uuid        NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission            text        NOT NULL CHECK (permission IN ('read','write')),
    inherit_to_children   boolean     NOT NULL DEFAULT true,
    granted_by            uuid        REFERENCES users(id),
    granted_at            timestamptz NOT NULL DEFAULT now(),
    revoked_at            timestamptz,
    PRIMARY KEY (folder_id, user_id)
);
```

### 4. `admin` Rolü Eklenmesi

Mevcut `roles` seed genişletildi (00003 migration revize edildi):

| id | name | Açıklama |
|----|------|----------|
| 1 | read | Envanter görüntüleme (salt okunur) |
| 2 | write | Envanter oluşturma/düzenleme (normal user) |
| 3 | **admin** | **Kullanıcı yönetimi + audit log erişimi + tüm envantere erişim** |

### 5. `item_relationships` — Tipli İlişkiler

```sql
CREATE TABLE item_relationships (
    source_item_id     uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    target_item_id     uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    relationship_type  text        NOT NULL
        CHECK (relationship_type IN ('hosted_on','accessed_via','part_of','related_to','depends_on')),
    metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_by         uuid        REFERENCES users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_item_id, target_item_id, relationship_type),
    CHECK (source_item_id <> target_item_id)
);
```

**Tip kullanımı:**

| Tip | Örnek |
|-----|-------|
| `hosted_on` | "postgres-main" → "server-db-01" |
| `accessed_via` | "prod-db" → "jump-server-1" (jump server zinciri!) |
| `part_of` | "postgres-main" → "ProjeA" (mantıksal grup item'ı olabilir) |
| `related_to` | Jenerik "ilgili" |
| `depends_on` | "web-app" → "redis-cache" |

**Faz 4 client'ta kullanım:**
- Item detay sayfasında "Related Items" panel'i.
- SSH açılırken `accessed_via` varsa → otomatik `ssh -J jump_host target_host` komutu üretilir.

### 6. `items.external_source` Kolonu (Faz 5 preparation)

Bkz. [ADR-0007](0007-external-secret-backends.md). Kolon tanımı:

```sql
ALTER TABLE items ADD COLUMN external_source jsonb;
-- veya items CREATE TABLE'ında inline
-- NULL ise: "native" item (Envanter'da yaşar)
-- Doluysa: {"type":"vault","path":"secret/data/projeA/db","key_mapping":{"password":"pw","url":"conn_str"}}
```

## 7. Organizational Conventions (Öneri, Zorunlu Değil)

Çok sayıda proje × çok sayıda ortam (prod/stage/test/lab) DevOps/SRE env'inde yaygın. Önerilen folder düzeni:

```
/ProjeA
├── Prod
│   ├── Servers       → web-01, db-01, cache-01
│   ├── Databases
│   └── URLs
├── Stage
├── Test
└── Lab

/ProjeB
├── Prod
└── Dev
```

Her item'a ayrıca `environment` field'ı doldurmak, proje sınırlarından bağımsız sorgu sağlar ("tüm prod DB'ler?").

**Bu şema tarafında zorlanmaz** — kullanıcı özgürce farklı düzenleyebilir. Sadece tavsiye.

## Alternatifler

### item_types: enum vs tablo
- Enum + CHECK constraint ile kazanç: basitlik, tip güvenliği.
- Reddedildi: Her yeni tip migration gerektirirdi. DevOps/SRE takımının kendine has tiplerini (örn: "kubernetes_secret", "aws_iam_role") migration talebetmeden eklemesi değerli.

### field_definitions: free-form key vs strict definitions
- Free-form (her item kendi key'ini seçer): esnek ama hostname/host_name drift.
- Reddedildi: Kullanıcı deneyimindeki kayıp fayda < tutarlılık kazancı.
- **Seçilen middle-ground:** type-to-search autocomplete + "yeni tanım oluştur" seçeneği. Friksiyon minimal, tutarlılık korunur.

### folder_permissions: basit grant vs deny override
- Sadece grant: daha az flexible, daha basit.
- Deny override: daha esnek (grant'i iptal ederek alt klasörü kilitle), karmaşık implementation.
- **Seçilen:** Sadece grant + `inherit_to_children` bool. MVP yeterli. Deny gerekirse Faz 5+'da eklenir.

### Groups/teams vs direct user permissions
- Group bazlı: "DevOps ekibi" klasöre erişir.
- Reddedildi (MVP): Şimdilik direkt kullanıcı-klasör izinleri yeterli. Grup desteği Parking Lot'ta.

## Sonuçlar

### Olumlu
- **Tutarlılık:** field_definitions sayesinde "hostname" kaosu yok.
- **Esneklik:** item_types + item_relationships DevOps envanterinin gerçek topolojisini yansıtır.
- **Güvenlik katmanı:** 3 seviye RBAC (global rol + folder ACL + item share) enterprise için yeterli granülerite.
- **Vault hazırlığı:** external_source kolonu şimdi eklenerek Faz 5'te migration gerekmeyecek.

### Olumsuz / Risk
- **Şema boyutu büyüdü:** 11 tablodan 17'ye. Daha fazla test yüzeyi.
- **UI karmaşıklığı:** Admin UI'da field/type/permission yönetim ekranları gerekli (Faz 3).
- **Performans:** "Tüm prod DB'ler" gibi cross-item filter için item_fields üzerinde decrypt gerekir (isim aramada olduğu gibi HMAC hash çözümü düşünülebilir, Faz 5 optimizasyonu).

### Nötr
- field_definitions.allowed_values jsonb → enum validation app-layer'da yapılır (DB CHECK'te dinamik mümkün değil).
- Bu şemanın SQL migration'ları **Faz 2 kapsamında** yazılacak (users/roles/sessions/audit_log'dan sonra).

## Faz Sorumlulukları

| Faz | İş |
|-----|-----|
| **Faz 1 (bu iteration sonu)** | 00003_roles.sql revize: admin rolü seed. Diğer tablolar Faz 2'ye. |
| **Faz 2** | Migration'lar: item_types, field_definitions (seed dahil), folders, folder_permissions, items, item_fields, item_shares, item_relationships. |
| **Faz 2** | RBAC middleware: effective permission = admin ? yes : aggregate(global_role, folder_permission_inherit, item_share). |
| **Faz 2** | field_definitions API: list, create. Permissions: sadece admin yaratabilir. |
| **Faz 3** | Admin UI: field_definitions yöneticisi, item_types yöneticisi, folder_permissions yöneticisi. |
| **Faz 4** | Client: item_types'a göre form otomatik render. item_relationships panel'i. `accessed_via` → SSH jump komutu. |

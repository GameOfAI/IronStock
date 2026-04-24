# 0005 — Database Migration Tool

- **Durum:** Accepted
- **Tarih:** 2026-04-24
- **Karar veren:** Burak Haşlaman (DevOps/SRE)

## Bağlam

Postgres şemasını versiyonlu yönetmek için bir migration tool gerekli. Seçenekler büyük farklılıklarla geliyor (SQL-first vs declarative, embed desteği, dialect coverage).

Gereksinimler:
- Postgres 16 native.
- Go binary'ye embed edilebilmeli (tek binary deployment).
- SQL migration'ları okumak ve review etmek kolay olmalı (audit trail için).
- CI'da "schema drift" detection.
- Production'da `migrate up` idempotent olmalı.

## Karar

**`goose`** (https://github.com/pressly/goose).

### Neden?

- SQL-first, okunabilir `NNN_description.sql` dosyaları.
- `embed.FS` ile binary içine gömülür — tek binary, dışarıdan migration file set'i gerekmez.
- Up/down ikili migration desteği.
- Postgres 16 native, schema locking desteği (concurrent run güvenliği).
- Küçük (~1.5k LOC), bağımlılık az.
- Ekip SQL'i okuyup onaylar — abstract DSL öğrenmek yok.

### Kullanım Paterni

```
server/migrations/
├── 00001_init_schema.sql
├── 00002_users.sql
├── 00003_roles_and_user_roles.sql
├── 00004_sessions.sql
├── 00005_audit_log.sql
└── ...
```

Her dosya iki section içerir:
```sql
-- +goose Up
CREATE TABLE ...;

-- +goose Down
DROP TABLE ...;
```

### CLI entegrasyonu

`server/cmd/migrate/main.go` ayrı bir binary olacak:
```bash
envanter-migrate up
envanter-migrate down
envanter-migrate status
envanter-migrate redo
```

Veya Makefile üzerinden:
```bash
make migrate-up
make migrate-down
```

### CI

- `server-integration` job (Faz 2'de eklenir): testcontainers-go ile temiz Postgres başlatır, tüm migration'ları up/down/up çalıştırır, schema'nın idempotent olduğunu doğrular.
- `migration lint` (Faz 2+): `sqlfluff` veya `squawk` ile syntax + best-practice check.

## Alternatifler

### golang-migrate/migrate
- **Artıları:** En popüler, çok DB destekli, binary + Go package.
- **Eksileri:** CLI ergonomik değil; `goose`'a kıyasla daha "classic", özel komut (`force`, `goto`) kafa karıştırıcı; embed desteği son yıllarda geldi ama daha az olgun.
- **Reddedildi:** Ekstra faydayı karşılığında ergonomi feda etmeye değmez.

### Atlas (ariga.io/atlas)
- **Artıları:** Declarative schema (HCL veya SQL). `atlas schema diff` ile mevcut DB ile hedef şema arasında migration **otomatik üretilir**. CI'da schema drift detection. Modern tooling (schema visualization, migration linting built-in).
- **Eksileri:**
  - Declarative + imperative karma yaklaşımı → öğrenme eğrisi.
  - HCL dili başka bir soyutlama (Terraform benzeri). Ekip için yeni.
  - Destructive migration (DROP COLUMN vs) için manuel müdahale gerekir — oto-üretim yanıltıcı olabilir.
  - Free-tier'de bazı özellikler kısıtlı, self-host + lisans dikkat gerektirir.
- **Reddedildi (şimdilik):** Projeye değer katar ama ekip **SQL migration'ları elle review** etmek istiyor (güvenlik-hassas proje). Atlas "auto-diff" tam tersini öneriyor — review-first felsefeye aykırı. **Faz 5+'de yeniden değerlendirilebilir** (ilerleyen şema karmaşıklığı Atlas'ın faydasını artırdığında).

### sqlboiler / gorm auto-migrate
- **Reddedildi:** ORM-coupled. Biz sqlc kullanıyoruz (SQL-first, ORM-less).

### Custom bash script + raw SQL
- **Reddedildi:** Versiyon takibi, concurrent-safe lock, rollback desteği el-yazısı ile yazılmaz.

### dbmate
- **Artıları:** Simple, SQL-first, benzer ergonomi.
- **Eksileri:** Go binary'ye embed için `goose` kadar olgun değil.
- **Reddedildi:** goose'a çok benzer ama ekosistem daha küçük.

## Sonuçlar

### Olumlu
- Ekip SQL file'larını direk review eder — güvenlik sunum katmanı.
- Embed ile tek binary deploy — k8s'te init container veya main process migration koşabilir.
- `goose` açık kaynak, bakımlı, prod-hazır.

### Olumsuz / Risk
- Declarative schema'mız yok — mevcut DB vs hedef arasında diff manuel.
- Migration dosyalarının **idempotent** olması sorumluluğu bizde (yazılırken dikkat). CI integration test bunu yakalar.
- Şema kompleksleştikçe migration dosyaları çoğalır (50+ olabilir). İleride Atlas'a migrasyon düşünülebilir — goose migration'ları Atlas-importable.

### Nötr
- Migration dosyaları `00001_...`, `00002_...` zaman damgalı değil **sıralı numara**. Branch merge conflict olursa numara çakışması rebase ile çözülür. 10k+ migration problem değil (goose scan performant).

## Faz Sorumlulukları

- **Faz 1 (bu faz):** İlk migration'lar — users, roles, sessions, audit_log.
- **Faz 2:** Envanter migration'ları — folders, items, item_fields, item_shares, master_keys, user_keypairs, totp_secrets, recovery_codes.
- **Faz 2:** `cmd/migrate` binary'si + Makefile hedefleri.
- **Faz 2:** CI'da migration integration test.

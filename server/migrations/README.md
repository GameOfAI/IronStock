# Migrations

Postgres şema migration'ları — [goose](https://github.com/pressly/goose) ile yönetilir.
Karar gerekçesi: [docs/adr/0005-migration-tool.md](../../docs/adr/0005-migration-tool.md).

## Dosya Düzeni

```
NNNNN_description.sql
```

- `NNNNN` = 5 haneli sıra numarası (sözlük sıralaması ile uyumlu).
- `description` = snake_case, kısa (1-3 kelime).
- Bir dosya tercihen tek mantıksal konsept (tablo, extension, index grubu).

## Dosya İçeriği (goose formatı)

```sql
-- +goose Up
-- +goose StatementBegin
CREATE TABLE ...;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE ...;
-- +goose StatementEnd
```

`StatementBegin`/`End` bloğu çoklu statement (function, trigger) veya `;` içeren DDL için gerekli. Tek DDL satırları için opsiyonel ama tutarlılık için her migration'da kullanıyoruz.

## Komutlar (Makefile)

```bash
make migrate-up      # Tüm pending migration'ları uygula
make migrate-down    # Son migration'ı geri al
make migrate-status  # Mevcut durum (Faz 2'de eklenecek)
make migrate-redo    # Son migration down + up
```

Doğrudan goose CLI ile de:
```bash
goose -dir server/migrations postgres "$DATABASE_URL" up
goose -dir server/migrations postgres "$DATABASE_URL" status
```

## Kurallar

1. **Uygulanmış migration'a dokunulmaz.** Değişiklik gerekirse yeni migration yazılır.
2. Her migration **Up + Down** içermelidir. Veri kaybı riski olan Down'larda UYARI yorumu.
3. **Idempotent** yazmaya çalışın: `CREATE TABLE IF NOT EXISTS`, `DROP ... IF EXISTS`. goose zaten version kontrol ediyor ama güvenli taraf.
4. **Destructive migration** (DROP COLUMN, data transform) için ayrı review. `-- WARNING:` yorumu ekle.
5. **Büyük tablo değişiklikleri** (10M+ satır): `ALTER TABLE ... ADD COLUMN` yerine multi-step (nullable ekle → backfill → not null + default) pattern'i kullan. Prod için `pg_repack` benzeri düşün.

## Faz 1 Migration'ları

| Dosya | Tablo/Obje | Açıklama |
|-------|-----------|----------|
| `00001_init_extensions.sql` | pgcrypto + `set_updated_at()` | Ortak altyapı |
| `00002_users.sql` | users | Argon2id password hash + status + soft-lock |
| `00003_roles.sql` | roles + user_roles (+ seed) | RBAC: read, write |
| `00004_sessions.sql` | sessions | Refresh token store + binding + revocation |
| `00005_audit_log.sql` | audit_log | Plaintext audit trail + BRIN index |

## Faz 2'de Eklenecek (önizleme)

- `00006_user_keypairs.sql` — E2E keypair
- `00007_totp_secrets.sql` — TOTP (envelope encrypted)
- `00008_recovery_codes.sql`
- `00009_master_keys.sql`
- `00010_folders.sql`
- `00011_items.sql` + `00012_item_fields.sql` + `00013_item_shares.sql`

## Integration Test (Faz 2)

testcontainers-go ile:
1. Temiz Postgres 16 başlat
2. `goose up` → tüm migration'lar
3. `goose down` N kez → tüm migration'lar geri alınır
4. `goose up` → tekrar forward
5. Schema beklenen durumda mı doğrula (`\d+` snapshot karşılaştırma)

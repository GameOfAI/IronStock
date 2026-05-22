# 0011 — Item Arama Modeli: name_plain + ILIKE Substring Search

- **Durum:** Implemented ✅ 2026-05-22 (PR-SEARCH)
- **Tarih:** 2026-05-22 (karar + uygulama aynı gün)
- **Karar veren:** Burak Haşlaman (DevOps/SRE)
- **İlgili ADR:** [0002](0002-security-model.md), [0004](0004-encryption-details.md)
- **Supersedes:** ADR-0004 §"Searchable Encryption" bölümü

## Bağlam

ADR-0004, item name araması için HMAC-SHA256 deterministic blind index tasarlamıştı:
- `items.name_search BYTEA` kolonu — HKDF'ten türetilen anahtar ile HMAC
- Arama yaparken client/server query token aynı HMAC'i hesaplar → exact match
- `server/internal/crypto/searchhash.go` ile implement edildi

**Sorun:** HMAC blind index **sadece tam eşleşme** sağlar. Örn: "prod-db" arayan kullanıcı "prod-db-primary" item'ını bulamaz. DevOps envanter kullanımında prefix/substring arama temel beklenti — anlamlı UX için tam eşleşme yeterli değil.

Alternatif olarak değerlendirilen bigram HMAC array yaklaşımı: her `n-gram` ayrı HMAC → array sütununda `@>` operatörü ile sorgu. Teorik olarak privacy'i koruyan substring search. Ancak:
- `name_search` zaten metadata alanında (şifrelenmemiş tuple içinde) — ADR-0002'de metadata E2E'ye dahil değil; server-side envelope encryption kapsamında
- Item adı "server secret" değil, "organizasyonel metadata" kategorisinde
- Bigram array index patlaması: item adındaki her 2-gram → onlarca HMAC → tablo boyutu ve sorgu karmaşıklığı

ADR-0002 ve ADR-0004'ün tasarım prensibi netleştirildi: **item name/folder/IP/hostname gibi metadata alanları server-side envelope encrypt'tir** — server bu plaintext'i görür, audit log'a yazar, index'ler. Client-side E2E sadece `is_secret=true` field'lar için (parola, token, private key).

Bu prensip göz önünde bulundurulduğunda, arama için HMAC yerine `name_plain TEXT` + `ILIKE` kullanmak güvenlik modelini bozmaz.

## Karar

### Item name için `name_plain TEXT` kolonu + PostgreSQL `ILIKE` arama

`items` tablosuna `name_plain TEXT` kolonu eklendi. Item oluşturma/güncelleme sırasında hem `name_enc` (envelope encrypt) hem `name_plain` (plaintext) yazılır.

**Arama sorgusu:**
```sql
WHERE name_plain ILIKE '%' || $1 || '%'
  AND (folder_id = $2 OR $2 IS NULL)
ORDER BY name_plain
```

`name_search BYTEA` kolonu korunur (geriye dönük uyumluluk) ama artık arama kritere girmez.

### Global cross-folder arama

Önceki arama: sadece aktif klasör içinde. Yeni özellik: **tüm erişilebilir klasörler** üzerinden arama.

```sql
-- Global arama sorgusu (ACL-aware):
WITH accessible_folders AS (
  SELECT DISTINCT folder_id FROM v_folder_effective_permissions
  WHERE user_id = $1 AND perm_level >= 'read'
)
SELECT i.* FROM items i
JOIN accessible_folders af ON i.folder_id = af.folder_id
WHERE i.name_plain ILIKE '%' || $2 || '%'
  AND i.deleted_at IS NULL
ORDER BY i.name_plain
LIMIT 100
```

### Uygulanan bileşenler (PR-SEARCH)

- `server/migrations/00039_name_plain.sql` — `items.name_plain TEXT` kolonu, `CREATE INDEX idx_items_name_plain ON items(name_plain)`, mevcut row backfill (ADR-0004'ün `name_search` alanından)
- `server/internal/httpapi/item_handlers.go` — `GET /api/v1/items?search=` query param + `POST /api/v1/items/search` endpoint (cross-folder)
- Frontend search input debounce artık `/api/v1/items/search` endpoint'ini çağırır, folder context dropdown ile toggle
- `web/src/components/inventory/search-bar.tsx` — global toggle switch eklendi
- `client/src/components/inventory/search-bar.tsx` — aynı güncelleme

## Alternatifler

### A) Bigram HMAC Array (Privacy-preserving substring search)
- Her item adındaki 2-gram'lar için HMAC üretilir, `name_search_grams BYTEA[]`'e yazılır.
- Arama: query token → bigram listesi → `name_search_grams @> ARRAY[gram1, gram2]`
- **Reddedildi:** Item name metadata kategorisinde (E2E değil). Bigram array'leri için index maliyeti yüksek. Geliştirme ve bakım karmaşıklığı orantısız.

### B) HMAC Exact Match + UI "en az 3 harf" uyarısı (mevcut durum koru)
- Kullanıcıya "tam isimle arayın" UX mesajı göster.
- **Reddedildi:** DevOps workflow'unda item naming tutarsız olabiliyor; tam isim bilinmeyebilir.

### C) PostgreSQL Full-Text Search (tsvector)
- `name_plain_tsv TSVECTOR` oluşturulur, GIN index.
- `to_tsquery('prod & db')` ile arama.
- **Değerlendirildi ama daha ileri:** FTS Türkçe stemmer gerektirir, dil konfigürasyonu ek karmaşıklık. ILIKE şimdilik 10K item'a kadar performans kabul edilebilir. 100K+ item olursa FTS'ye migrasyon ADR revize edilerek yapılabilir.

## Sonuçlar

### Olumlu
- **Substring ve prefix arama** — "prod" yazınca "prod-db-primary", "prod-web-1" hepsi bulunur.
- **Global cross-folder arama** — tek query, ACL-aware.
- **Düşük implementasyon karmaşıklığı** — `ILIKE` standard SQL, hiçbir kriptografik hesaplama yok.
- **Güvenlik modeli bozulmaz** — name metadata kategorisinde, server zaten görüyor.

### Olumsuz / Risk
- **ILIKE skalası** — 100K+ item'da GIN index olmadan yavaşlayabilir. Şu an tablo başına max ~10K item bekleniyor; gerekirse `CREATE INDEX idx_items_name_plain_trgm USING GIN (name_plain gin_trgm_ops)` ile trigram index eklenebilir (pg_trgm extension).
- **`name_search` alanı korunuyor** — Gereksiz bir alan. Gelecekte migration ile kaldırılabilir (Parking Lot).
- **name_plain plaintext** — DB dump'ta item adları görünür. Ancak ADR-0002'de bu bilinçli tradeoff; metadata E2E kapsamında değil.

### Nötr
- `searchhash.go` paketi hâlâ var, unused. Export search gibi başka amaçlar için kullanılabilir.
- Gelecekte tüm text metadata alanları (folder name, tags) aynı pattern'a genişletilebilir.

## Referanslar

- ADR-0004 §Searchable Encryption: HMAC-SHA256 deterministic hash, HKDF
- PostgreSQL ILIKE: https://www.postgresql.org/docs/current/functions-matching.html
- pg_trgm: https://www.postgresql.org/docs/current/pgtrgm.html (gelecek geçiş için)

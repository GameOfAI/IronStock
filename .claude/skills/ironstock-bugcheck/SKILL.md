---
name: ironstock-bugcheck
description: IronStock bug tespit ve doğrulama akışı — Go/TypeScript/Rust lint+test+vuln taraması, kripto kontrol listesi ve sistematik hata ayıklama. "Bug var mı?", "test yaz", "lint çalıştır", "hata ayıkla" gibi taleplerde aktif olur.
---

# IronStock Bug Check

## Standart Kontrol Sırası

Her değişiklik öncesi veya bug şüphesinde bu sırayı takip et:

### 1. Format (önce düzelt, sonra kontrol et)
```bash
make fmt
```

### 2. Lint
```bash
make lint
# Tek katman için:
make lint-server   # golangci-lint
make lint-web      # eslint
make lint-client   # eslint + cargo clippy -D warnings
```

### 3. Unit Test
```bash
make test
# Tek katman için:
make test-server   # go test ./...
make test-web      # vitest
make test-client   # cargo test
```

### 4. Güvenlik Taraması
```bash
cd server && govulncheck ./...
cd client/src-tauri && cargo audit
cd web && npm audit
```

### 5. Integration Test (DB gerektirir)
```bash
make test-integration   # testcontainers-go + gerçek Postgres
```

### 6. Generated Code Drift Kontrolü
```bash
make gen-check   # sqlc + oapi + ts tipleri güncel mi?
```

---

## Kripto Bug Kontrol Listesi

Kripto ile ilgili değişikliklerde elle kontrol et:

- [ ] IV/nonce her şifreleme operasyonunda `crypto.getRandomValues()` ile taze üretiliyor
- [ ] DEK unwrap başarısız olduğunda hata kullanıcıya internal detay sızdırmıyor
- [ ] `private_key_enc` memory'de tutulup session kapatıldığında sıfırlanıyor (Zustand store `zeroize`)
- [ ] Argon2id `kek_salt` her kullanıcı için unique ve DB'de saklanıyor
- [ ] change-password akışında public key değişmiyor, sadece `private_key_enc` re-wrap ediliyor
- [ ] item_shares'deki wrapped DEK'ler paroladaki değişimden etkilenmiyor

---

## Auth Bug Kontrol Listesi

- [ ] Access token memory-only (localStorage'a yazılmıyor)
- [ ] Refresh token HttpOnly cookie (JS erişemez)
- [ ] `disable user` → tüm session'lar revoke ediliyor
- [ ] Rate limit: login, totp/verify, recover, change-password endpoint'leri
- [ ] JWT expiry: access 15dk, refresh 7 gün

---

## Sistematik Hata Ayıklama Akışı

Bir bug rapor edildiğinde:

1. **Katmanı belirle** — server log mu, client console mu, DB mi?
2. **Reproduce et** — minimal adımlarla tekrarla
3. **Hipotez kur** — tek bir neden varsay
4. **Test et** — hipotezi doğrulayan en küçük testi yaz
5. **Düzelt** — sadece hipotezi çözen değişikliği yap
6. **Regresyon testi** — ilgili mevcut testler hâlâ geçiyor mu?

---

## Yaygın Bug Kalıpları

### Go
- `nil` pointer: interface döndüren fonksiyonlarda her zaman `err != nil` kontrolü
- Context leak: goroutine başlatırken `ctx.Done()` dinle
- Race condition: `go test -race ./...` ile tespit et

### TypeScript / React
- Stale closure: `useEffect` dependency array eksik
- Type assertion: `as` yerine type guard tercih et
- Async hata: `await` unutulan Promise sessizce başarısız olur

### Kripto (WebCrypto)
- `SubtleCrypto` operasyonları `Promise` döner — `await` unutma
- `ArrayBuffer` → `Uint8Array` dönüşümü: `new Uint8Array(buffer)`
- Base64 encode/decode: `btoa`/`atob` yerine proje `shared/pkg/src/crypto.ts` helper'larını kullan

### WebSocket
- Chi `Timeout` middleware Hijack ile uyumsuz — `/ws` route'u timeout middleware dışında tutulmalı
- Reconnect loop: exponential backoff olmadan sonsuz döngü riski

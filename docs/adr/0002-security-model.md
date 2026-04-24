# 0002 — Hibrit Şifreleme Modeli

- **Durum:** Accepted
- **Tarih:** 2026-04-24
- **Karar veren:** Burak Haşlaman (DevOps/SRE)

## Bağlam

Envanter uygulaması aşağıdaki veri tiplerini saklıyor:
- **Metadata:** item ismi, klasör yolu, IP, hostname, hardware specs (CPU/RAM/Disk), notlar.
- **Secret field'lar:** parola, SSH private key, API token, URL credential'ları.
- **Audit log:** kim, ne zaman, ne yaptı.

Gereksinimler:
- Server compromise olursa bile credential'lar plaintext sızmamalı.
- Admin panelinde metadata üzerinde arama / filtreleme / raporlama mümkün olmalı.
- Kullanıcılar arası **item paylaşımı** desteklenmeli (rol bazlı).
- Audit log okunabilir olmalı (incident response ve uyumluluk için).
- Master parolayı unutan kullanıcı → admin reset ile kurtarılabilir olmalı (ama bu secret'ları tehlikeye atmamalı).

## Karar

**Hibrit model** — veri tipine göre farklı şifreleme:

### 1. Metadata → Server-side envelope encryption
- **Master key:** k8s Secret veya External Secrets Operator üzerinden KMS (AWS KMS / GCP KMS / HashiCorp Vault) — Faz 5.
- **Per-item DEK:** Her item için rastgele AES-256 key üretilir, master key ile wrap edilir ve DB'de saklanır.
- **Algoritma:** AES-256-GCM (nonce per encryption, authenticated).
- **Searchable field'lar** (item name, hostname): deterministic encryption veya blind index ile aranabilir (Faz 1'de detay ADR).

### 2. Secret field'lar → Client-side E2E encryption
- Kullanıcının master parolasından **Argon2id** ile anahtar türetilir:
  - `time=3`, `memory=64MiB`, `parallelism=4`, salt kullanıcı başına random 16B.
  - Parametreler `user.argon2_params` sütununda saklanır (ileride yükseltme için).
- Türetilen key kullanıcının **private key'ini** decrypt eder (private key user tablosunda encrypted saklanır).
- Paylaşılan item'larda **per-item DEK** yetkili kullanıcıların public key'leri (X25519) ile wrap edilir → her kullanıcı kendi private key'i ile açar.
- Server secret field'ların **plaintext'ini asla görmez**, asla log'lamaz.

### 3. Audit log → Server-side plaintext
- Kim (user_id), ne zaman, ne action (item.create, item.update, auth.login), hangi kaynakta (resource_id).
- Detay alanlarında secret yok (sadece metadata).
- DB'de plaintext, Faz 5'te append-only tablo + integrity hash chain.

### Master parola sıfırlama
- Kullanıcı master parolasını unutursa: admin "key reset" başlatır → kullanıcı yeni parola belirler → **eski secret'ları kaybeder** (çünkü private key yeni paroladan türeyen key ile re-encrypt edilemez, eski key yok).
- Bu riski azaltmak için kullanıcıya **recovery code** verilir (Faz 2): Argon2id parametreleri ile türetilmiş yedek key, kullanıcı güvenli şekilde saklar.

## Alternatifler

### A) Tam server-side encryption (sadece envelope)
- Tüm alanlar DB'de şifreli, key k8s Secret'ta.
- **Reddedildi:** Server compromise olursa hem key hem veri aynı ortamda → tam plaintext leak. KeePassXC'nin kullanıcıya sunduğu "server sahibi bile göremez" garantisini sağlayamaz.

### B) Tam E2E encryption (KeePassXC modeli)
- Server sadece şifreli blob saklar, metadata bile şifreli.
- **Reddedildi:**
  - Admin panelinde arama/rapor yapılamaz.
  - Paylaşım kompleks (her paylaşım için blob duplicate ve re-encrypt).
  - Audit log da şifreli → incident response imkansız.
  - Storage büyür (blob update = tüm blob yeniden yazılır).

### C) Hibrit (seçilen)
- Metadata performansı ve yönetilebilirliği korur, credential'lar E2E güvenliği alır. Modern password manager'ların yaklaşımı (1Password, Bitwarden).

## Sonuçlar

### Olumlu
- Server compromise → credential'lar plaintext değil (saldırganın ayrıca her kullanıcının master parolasını kırması gerekir).
- Admin panel metadata üzerinde tam yetenekli.
- Ekip paylaşımı X25519 wrap ile temiz çözülür.
- Sektör-kabul modeli (Bitwarden benzeri) → test edilmiş paradigma.

### Olumsuz / Risk
- Master parola unutulursa kullanıcının secret'ları kaybedilir (recovery code zorunlu).
- Client-side crypto bug'lar → veri kurtarılamaz hale gelebilir. Bu nedenle:
  - Client crypto kodu **kapsamlı test** edilecek (known-answer tests dahil).
  - Versiyonlama: her şifreli blob başına `version` field → algoritma yükseltmesi için.
- Admin metadata'yı görebilir → iç tehdit modelinde admin sınırlı güvenilir (audit log + role separation gerekir).

### Nötr
- Argon2id parametreleri donanım gelişimiyle zamanla artırılmalı (her 2-3 yılda bir revizyon).

## Faz Sorumlulukları

- **Faz 1:** Algoritma detayları, key derivation, DB şeması — `0004-encryption-details.md` ADR'ı (ileride).
- **Faz 2:** Server-side envelope kodu + recovery code sistemi.
- **Faz 4:** Client-side Argon2id + X25519 implementasyonu.
- **Faz 5:** KMS / External Secrets entegrasyonu.

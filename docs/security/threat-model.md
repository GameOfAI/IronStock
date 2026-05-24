# IronStock Tehdit Modeli

## Genel Bakış

IronStock, DevOps/SRE ekipleri için uçtan uca şifreli (E2E) credential vault uygulamasıdır. Bu döküman uygulamanın güvenlik mimarisini, tehdit vektörlerini ve alınan önlemleri tanımlar.

## Güvenlik Mimarisi

### Şifreleme Katmanları

```
Kullanıcı Şifresi
    ↓ Argon2id (KDF)
KEK (Key Encryption Key)
    ↓ AES-256-GCM
Kullanıcı Private Key (X25519)
    ↓ ECDH + HKDF-SHA256
DEK (Data Encryption Key) — item başına
    ↓ AES-256-GCM
Field Value (şifreli veri)
```

### Anahtar Hiyerarşisi

| Anahtar | Amaç | Saklama Yeri |
|---------|------|-------------|
| Master Key | Server-side envelope encryption | Ortam değişkeni (base64) |
| KEK | Kullanıcı private key'i şifreleme | Kullanıcı şifresinden türetilir (Argon2id) |
| User Keypair | E2E key exchange (X25519) | Public: DB plaintext, Private: DB (KEK ile şifreli) |
| DEK | Item field değerlerini şifreleme | DB (owner + paylaşılan kullanıcı key'leriyle wrap'lı) |

### Sıfır-Bilgi (Zero-Knowledge)

- Sunucu hiçbir zaman kullanıcı şifresini veya DEK'leri plaintext olarak görmez
- Field değerleri istemci tarafında şifrelenir/çözülür (Web Crypto API)
- Paylaşım: gönderen kullanıcı DEK'i alıcının public key'i ile wrap eder
- Sunucu yalnızca şifreli blob'ları saklar

## Tehdit Vektörleri ve Önlemler

### T1: Veritabanı Sızıntısı (Data-at-Rest)

**Tehdit:** Saldırgan DB dump'ına erişim sağlar.

**Önlemler:**
- Tüm hassas field değerleri AES-256-GCM ile şifreli
- DEK'ler kullanıcı public key'leriyle wrap'lı — DB'den çözülemez
- Master key DB'de saklanmaz (ortam değişkeni)
- Şifreler Argon2id hash'li (salt + params ayrı sütun)

**Kalan Risk:** Metadata (item adları `name_plain`, klasör yapısı, audit log'lar) plaintext.

### T2: Oturum Ele Geçirme (Session Hijacking)

**Tehdit:** JWT token çalınması.

**Önlemler:**
- Access token kısa ömürlü (15 dk)
- Refresh token DB'de saklanır, çalınırsa revoke edilebilir
- `POST /auth/logout-all` ile tüm oturumlar sonlandırılabilir
- Admin `disable` işlemi tüm oturumları revoke eder
- WebSocket bağlantısı tek kullanımlık ticket gerektirir

### T3: Brute-Force Saldırısı

**Tehdit:** Şifre tahmin saldırısı.

**Önlemler:**
- Rate limiting (IP bazlı, memory veya Redis backend)
- Argon2id yüksek maliyet parametreleri
- TOTP 2FA (per-user zorunlu kılınabilir)
- WebAuthn/FIDO2 desteği (hardware key)
- IP whitelist + ülke kısıtlama + Tor çıkış düğümü engelleme
- Auth hataları `envanter_auth_failures_total` metriği ile izlenir

### T4: İç Tehdit (Insider Threat)

**Tehdit:** Yetkili kullanıcı veya admin kötüye kullanım.

**Önlemler:**
- E2E şifreleme — admin bile paylaşılmamış item'ları çözemez
- Tam audit log (tüm CRUD + auth + admin işlemleri)
- Break-glass hesap kullanımı özel metrik ve bildirimle izlenir
- Log yönlendirme (Syslog/Splunk/Elastic) — log'lar değiştirilemez
- Credential rotation takibi + sağlık skoru

### T5: Supply Chain Saldırısı

**Tehdit:** Bağımlılık zinciri üzerinden zararlı kod enjeksiyonu.

**Önlemler:**
- Dependabot haftalık güncelleme (6 ecosystem)
- CI güvenlik taraması: gosec, govulncheck, Trivy, npm audit, Semgrep, Gitleaks
- Pre-commit hook'ları: gitleaks (hardcoded secret tespiti)
- Container imaj taraması (Trivy HIGH+CRITICAL)

### T6: API İstismarı

**Tehdit:** OWASP Top 10 zafiyetleri.

**Önlemler:**
- SQL injection: parametreli sorgular (pgx prepared statements)
- XSS: React otomatik escape + CSP header'ları
- CSRF: SameSite cookie + CORS origin kontrolü
- Path traversal: chi router pattern matching
- Mass assignment: açık alan listesi (struct tag'leri)
- Broken auth: JWT doğrulama middleware tüm korumalı route'larda

### T7: WebSocket Güvenliği

**Tehdit:** WS bağlantısı üzerinden yetkisiz erişim.

**Önlemler:**
- Bağlantı kurulumu tek kullanımlık ticket gerektirir (POST /ws/ticket → JWT auth)
- Origin kontrolü (`ENVANTER_WS_ALLOWED_ORIGINS`)
- Mesajlarda hassas veri yok — yalnızca event bildirimleri (item UUID'leri)
- Ping/pong + overflow drop mekanizması

### T8: mTLS Bypass

**Tehdit:** İstemci sertifika doğrulamasının atlatılması.

**Önlemler:**
- Built-in CA ile sertifika üretimi (AES-256-GCM ile master key korumalı)
- Per-user `cert_required` flag'i
- Sertifika revocation (admin panelden)
- X-Client-Cert-PEM header doğrulaması

## Kriptografik Detaylar

| İşlem | Algoritma | Notlar |
|-------|-----------|--------|
| Şifre hash | Argon2id | Salt + params DB'de |
| KDF (şifre → KEK) | Argon2id | Client-side |
| Key exchange | X25519 ECDH | Curve25519 keypair |
| Key derivation | HKDF-SHA256 | Shared secret → DEK |
| Veri şifreleme | AES-256-GCM | 12-byte nonce, 16-byte tag |
| Key wrapping | AES-256-GCM | DEK'i public key ile wrap |
| JWT imzalama | HMAC-SHA256 | Server-side |
| Secret fingerprint | SHA-256 | Leak detection için |
| Client cert CA | RSA-4096 / ECDSA | Built-in CA private key AES-GCM encrypted |

## Audit Log Alanları

Her audit kaydı şu alanları içerir:

| Alan | Açıklama |
|------|----------|
| `id` | UUID |
| `actor_user_id` | İşlemi yapan kullanıcı |
| `action` | İşlem türü (ör. `item.create`, `auth.login`) |
| `resource_type` | Kaynak tipi (`user`, `item`, `folder`, vb.) |
| `resource_id` | Etkilenen kaynak UUID'si |
| `details` | JSON ek detaylar |
| `ip_address` | İstemci IP'si |
| `user_agent` | İstemci user-agent |
| `created_at` | Zaman damgası |

### Audit Action Türleri

- `auth.*`: login, logout, register, password_change, totp_*, webauthn_*, bootstrap_*
- `item.*`: create, update, delete, share, unshare, rotate, dynamic_cred_*
- `folder.*`: create, update, delete, permission_grant, permission_revoke
- `admin.*`: user_disabled, user_enabled, role_granted, role_revoked, export_*
- `security.*`: leak_detected, ip_restriction_updated

## Uyumluluk Kontrol Listesi

- [x] Veri-at-rest şifreleme (AES-256-GCM)
- [x] Transport şifreleme (TLS)
- [x] Çok faktörlü kimlik doğrulama (TOTP + WebAuthn)
- [x] Audit trail (tüm işlemler loglanır)
- [x] Rol tabanlı erişim kontrolü (RBAC)
- [x] Otomatik oturum sonlandırma
- [x] Şifre karmaşıklık politikası
- [x] Secret rotation takibi
- [x] IP kısıtlama + GeoIP

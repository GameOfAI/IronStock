# 0004 — Şifreleme Detayları

- **Durum:** Accepted
- **Tarih:** 2026-04-24
- **Karar veren:** Burak Haşlaman (DevOps/SRE)
- **Süper-ADR:** [0002-security-model.md](0002-security-model.md)

## Bağlam

ADR-0002'de hibrit şifreleme modeli kararlaştırıldı (metadata server-side envelope, secret'lar client-side E2E, audit log plaintext). Bu ADR **algoritmalar, parametreler, anahtar hiyerarşisi, veri formatları ve akışları** detaylandırır.

Yanlış kripto = veri kaybı veya leak. Bu belge implementasyon için kaynak doğruluğu. Değişiklik yeni ADR ile.

## Karar

### 1. Algoritma Seçimleri

| Amaç | Algoritma | Parametreler |
|------|-----------|--------------|
| Simetrik AEAD | **AES-256-GCM** | 96-bit nonce (random), 128-bit auth tag |
| Key wrap (asimetrik) | **X25519 + HKDF-SHA256 + AES-256-GCM** | libsodium `crypto_box` tarzı sealed box |
| Password hash | **Argon2id** | t=3, m=64 MiB, p=4, salt=16B, tag=32B |
| Client KEK derivation | **Argon2id** | aynı params, ayrı salt |
| MAC / search hash | **HMAC-SHA256** | truncate-to-128-bit |
| Token hash (refresh token, recovery code) | **SHA-256** (token) / **Argon2id** (recovery code) | — |
| CSPRNG | **OS random** | Go: `crypto/rand`, Rust: `rand::rngs::OsRng` |
| HKDF | **HKDF-SHA256** | — |

**Gerekçeler:**
- **AES-256-GCM:** NIST SP 800-38D, AEAD, hardware-accelerated (AES-NI her modern CPU'da), Go stdlib + RustCrypto olgun, FIPS uyumlu.
- **X25519:** 32B public key, 32B private key, timing-safe, padding saldırısına kapalı (RSA-OAEP'den üstün).
- **Argon2id:** PHC Password Hashing Competition kazananı, GPU/ASIC resistant, memory-hard, RFC 9106'da parametre önerileri.
- **HMAC-SHA256 for search:** Deterministic (aynı plaintext → aynı hash, arama mümkün). Truncate-to-128-bit collision riski ihmal edilebilir (2^64 messages).

### 2. Key Hierarchy

```
╔══════════════════════╗
║ KMS (Faz 5)          ║
║ veya k8s Secret      ║   <- master key burada dinlenir, prod'da KMS
║ (Faz 1-4 dev)        ║
╚═══════════╤══════════╝
            │ wraps
            ▼
┌──────────────────────┐
│  MASTER_KEY (32B)    │     master_keys.wrapped_key
│  aktif=1, versiyonlu │     rotation: 6-12 ayda bir
└───────────┬──────────┘
            │ wraps per resource
            ▼
┌───────────────────────────────────────┐
│  SERVER_DEK (32B, per item/folder)    │     items.server_dek_wrapped
│  metadata alanları bu key ile şifreli │     folders.name_enc
└───────────────────────────────────────┘

--- BAĞIMSIZ ZİNCİR (server plaintext'ini asla görmez) ---

┌─────────────────────┐
│  MASTER PASSWORD    │    kullanıcıda, serverda yok
│  (kullanıcı girer)  │
└──────────┬──────────┘
           │ Argon2id(pw, user_keypairs.kek_salt)
           ▼
┌─────────────────────┐
│  KEK (32B)          │    RAM-only, session süresince
│  key-encrypting-key │    auto-lock timeout'unda silinir
└──────────┬──────────┘
           │ unwraps (AES-GCM-decrypt)
           ▼
┌─────────────────────┐
│  USER PRIVATE KEY   │    user_keypairs.private_key_enc
│  (X25519, 32B priv) │    plaintext priv RAM'de
└──────────┬──────────┘
           │ unwraps per share (crypto_box_open)
           ▼
┌─────────────────────────────────────┐
│  E2E_DEK (32B, per item if shared)  │    item_shares.e2e_dek_wrapped
│  secret field'lar bu key ile şifreli│    her share için ayrı wrap
└─────────────────────────────────────┘
```

### 3. Encrypted Blob Formatı

Tüm şifreli kolon (bytea) **versiyonlu yapı**:

```
┌────────┬────────┬────────┬─────────────────┬────────────┐
│version │ alg_id │ nonce  │   ciphertext    │  auth_tag  │
│  1B    │  1B    │  12B   │   N bytes       │   16B      │
└────────┴────────┴────────┴─────────────────┴────────────┘
```

- **version** (`0x01` ilk sürüm): Şema değişirse artar, eski veri desteği kalır.
- **alg_id**:
  - `0x01` → AES-256-GCM
  - `0x02` → X25519 sealed-box (libsodium format: `nonce || ephemeral_pub || ciphertext || tag`)
  - (ileride yeni algoritmalar için genişletilebilir)
- **nonce**: 12B random (AES-GCM için). Her şifreleme sırasında CSPRNG ile üretilir.
- **ciphertext**: Plaintext ile aynı uzunluk.
- **auth_tag**: GCM authentication tag.

Toplam overhead: 30 byte.

**AAD (Associated Data):**
- `{table}:{row_id}:{column}` formatı AAD olarak kullanılır. Bu, row/column karışıklığı olursa decryption fail'ini garantiler (substitution attack savunması).
- Örnek: `"items:3f4a...:name_enc"`.

### 4. Argon2id Parametreleri

| Kullanım | time | memory | parallelism | salt | tag | Not |
|----------|------|--------|-------------|------|-----|-----|
| **Password hash** (server-side verify) | 3 | 64 MiB | 4 | 16B random per-user | 32B | `users.password_hash` |
| **Client KEK derivation** | 3 | 64 MiB | 4 | 16B random per-user | 32B | `user_keypairs.kek_salt` |
| **Recovery code hash** | 3 | 64 MiB | 4 | 16B random per-code | 32B | `recovery_codes.code_hash` |

- Parametreler `users.argon2_params` (jsonb) ve `user_keypairs.kek_params` içinde saklanır. Donanım gelişimi ile artırılabilir.
- Yeni kullanıcı güncel parametre alır. Mevcut kullanıcılar bir sonraki login'de re-hash ile yükseltilir (silent upgrade).
- **Server Argon2id'yi aynı anda max N parallel çalıştırır** (Faz 2: rate limit + semaphore; varsayılan 4).

### 5. Client-Side E2E Akışları

#### 5.1 Kayıt (Register)

```text
Client üretir:
  kek_salt := random(16B)
  KEK      := Argon2id(master_password, kek_salt, params)
  (pub, priv) := X25519_keypair()
  priv_enc := AES-256-GCM(priv, KEK, random_nonce, aad="user:<placeholder>:privkey")

Server'a gönderilir:
  POST /api/v1/auth/register {
    username, email,
    master_password,                        ← TLS altında, server hash'leyecek
    public_key: pub,
    private_key_enc: priv_enc,
    kek_salt, kek_params,
  }

Server:
  1. Argon2id(master_password, server_salt) → password_hash
  2. users + user_keypairs + (TOTP setup 2. adımda)
  3. master_password'u kayıtsız sil (RAM'den).
```

#### 5.2 Giriş (Login)

```text
Client:
  POST /api/v1/auth/login { username, master_password, totp_code }

Server:
  1. users.password_hash ile Argon2id.Verify(master_password).
  2. TOTP verify.
  3. Yeni session + access_token (15dk) + refresh_token (7g).
  4. user_keypairs'ı döner.

Server response: {
  access_token, refresh_token,
  user: { id, username, email, roles },
  keypair: { public_key, private_key_enc, kek_salt, kek_params }
}

Client:
  KEK := Argon2id(master_password, kek_salt, kek_params)
  priv := AES-GCM-decrypt(private_key_enc, KEK, aad="user:<id>:privkey")
  in-memory vault: { KEK, priv }     ← auto-lock timeout (5dk idle default)
  master_password'u RAM'den sil.
```

#### 5.3 Item Secret Field Okuma

```text
Client:
  GET /api/v1/items/:id
  response: {
    meta: { name, type, folder_id, ... (server tarafından decrypt) },
    fields: [
      { key: "ip", value: "10.0.0.5", is_secret: false },              ← server decrypt etti
      { key: "password", value_enc: <bytes>, is_secret: true },        ← client decrypt edecek
    ],
    share: { e2e_dek_wrapped: <bytes> }                                 ← kullanıcının kendi wrap'i
  }
  
  e2e_dek := X25519_seal_open(share.e2e_dek_wrapped, self.priv, aad="item:<id>:dek")
  
  for field in fields where is_secret:
    field.value := AES-GCM-decrypt(field.value_enc, e2e_dek, aad="item:<id>:<field.key>")
```

#### 5.4 Item Oluşturma

```text
Client:
  e2e_dek := random(32B)
  
  secret_fields = [
    { key: "password", value_enc: AES-GCM-encrypt(value, e2e_dek, aad="item:<pending>:password"), is_secret: true }
  ]
  plain_metadata_fields = [
    { key: "ip", value: "10.0.0.5", is_secret: false }                  ← server encrypt edecek
  ]
  
  own_wrapped_dek := X25519_seal(e2e_dek, self.public_key, aad="item:<pending>:dek")
  
  POST /api/v1/items {
    folder_id, name, item_type,
    fields: secret_fields + plain_metadata_fields,
    initial_share: { user_id: self, wrapped_dek: own_wrapped_dek }
  }

Server:
  1. Item row oluştur, `id := uuid_generate()`.
  2. server_dek := random(32B)
  3. name_enc := AES-GCM-encrypt(name, server_dek, aad="items:<id>:name")
     name_search := HMAC-SHA256(search_key, lowercase(name))[:16]
     server_dek_wrapped := AES-GCM-encrypt(server_dek, master_key, aad="items:<id>:dek")
  4. Non-secret field'ları server_dek ile şifrele ve item_fields'e yaz.
  5. Secret field'ları AADlerde placeholder "pending"dense AAD'yi gerçek id ile yeniden yazma gerekir.
     → Client'a istek yapılmadan önce UUID client tarafından üretilip server'a verilir (çözüm: client UUID v7).
  6. item_shares (self) → initial_share.
```

**AAD pending problemi:** Yukarıdaki `aad="item:<pending>:password"` — item id'yi daha oluşturmadan bilmiyoruz. İki çözüm:

- **A)** Client UUID üretir (UUID v7), AAD'lere dahil eder, server bu UUID'yi kabul eder. **Seçim: A.**
- B) AAD'de item id yerine folder id + name hash kullan. Karmaşık, zayıf.

Karar: **UUID v7 client'ta üretilir**. Bu standart (draft-ietf-uuidrev-rfc4122bis), monotonic, sıralamalı, güvenli.

#### 5.5 Item Paylaşma

```text
Alice (sahip):
  e2e_dek := X25519_seal_open(self.wrapped_dek, self.priv)
  
  # Bob'un public key'ini server'dan çek
  bob_pub := GET /api/v1/users/:bob_id/public-key

  wrapped_for_bob := X25519_seal(e2e_dek, bob_pub, aad="item:<id>:dek")
  
  POST /api/v1/items/:id/shares {
    user_id: bob.id,
    wrapped_dek: wrapped_for_bob,
    permission: "read"
  }
```

**Permission revoke** edilirse:
1. DEK yeniden üretilir: `new_e2e_dek := random(32B)`.
2. Kalan her authorized user için `X25519_seal(new_e2e_dek, user.pub)` yapılır, `item_shares.e2e_dek_wrapped` güncellenir.
3. Tüm secret field'lar `new_e2e_dek` ile yeniden şifrelenir.
4. Yeni DEK, server üzerinde oluşturulamaz (plaintext görmediği için) → **client tarafında** yapılır: owner client'ı yeni DEK ile yeniden şifrelemeli ve sonucu toplu PATCH ile server'a göndermeli. Offline user'lar gecikmeli günceller.

Bu bir trade-off: **revoked user 'T0'dan sonra yeni veriyi okuyamaz, ama T0 öncesi görmüş olduğu DEK'i unutamaz** (cache, ekran kaydı vs.). Bu password manager sektörü standardı — "revoke = future access only".

### 6. Server-Side Envelope Akışı (Metadata)

```go
// Yazma — pseudocode
dek := randomBytes(32)
nonce := randomBytes(12)
ciphertext := aesGCM(dek, nonce, plaintext, aad=fmt.Sprintf("%s:%s:%s", table, id, column))
wrappedDek, wrapNonce := aesGCM(masterKey, randomBytes(12), dek, aad=fmt.Sprintf("%s:%s:dek", table, id))

// DB row: { ..., col_enc: pack(version, algId, nonce, ciphertext, tag), dek_wrapped: pack(...), master_key_id }
```

```go
// Okuma
masterKey := loadMasterKey(row.master_key_id)
dek := aesGCMDecrypt(row.dek_wrapped, masterKey, aad=...)
plaintext := aesGCMDecrypt(row.col_enc, dek, aad=...)
```

### 7. Searchable Encryption (Deterministic Hash)

Metadata arama için `name_search` kolonu:

```go
searchKey := HKDF-SHA256(masterKey, salt="envanter-search-v1", info="", len=32)
searchHash := HMAC-SHA256(searchKey, toLowerASCII(NFKC(name)))[:16]
```

**Kullanım:**
- Insert/update'te yazılır.
- Query'de `WHERE name_search = $1`.

**Leak:**
- Aynı isimli iki item'ın hash'i aynı → frequency analysis mümkün. Bu kabul edilir (name secret değil, metadata).
- Prefix match yok. İleride gerekirse bigram/trigram blind index (her 2-3 harf için ayrı hash) eklenebilir.

### 8. Key Rotation Stratejisi

#### 8.1 Master Key Rotation (6-12 ayda bir)
1. Yeni master key üret, KMS'e kaydet, `master_keys` tablosuna yeni version ekle, `active=true`.
2. Eski key `active=false`, ama silinmez.
3. Background batch job: Her `wrapped_key` field'ını eski → yeni master key ile re-wrap. Tamamlanana kadar her iki key aktif.
4. Batch job tamamlanınca eski master key KMS'te disable edilir (ama 30 gün saklanır, audit için).

#### 8.2 E2E DEK Rotation (Permission revoke veya compromise şüphesi)
- Client-driven. Server API: `POST /items/:id/rotate-dek` endpoint'i (owner yapar).
- Bkz. 5.5 sonundaki flow.

#### 8.3 User Keypair Rotation
- Şimdilik **desteklenmez** (karmaşıklık yüksek).
- Master password değişirse: KEK değişir, `private_key_enc` yeniden şifrelenir, keypair sabit kalır.
- Keypair rotation Faz 5+'te değerlendirilir. Gerekirse: yeni keypair üretilir, tüm item_shares re-wrap edilir.

### 9. Recovery Codes

#### Sağlanma (Register sırasında)
```text
Server:
  codes := [16-digit random for _ in 10]
  for each code:
    store Argon2id-hashed version in recovery_codes (tek kez gösterildiği için plaintext gönderilir ve dönüş sonrası server unutur)
  response: { recovery_codes: [...] }   ← kullanıcıya BİR KEZ gösterilir
```

#### Kullanım (Master password unutulduğunda)
```text
Client:
  POST /api/v1/auth/recover { username, recovery_code }
  response: { tmp_token } (15dk, tek kullanımlık)
  
  # Kullanıcı yeni master password belirler
  POST /api/v1/auth/set-master-password { tmp_token, new_master_password }
  
  # Yeni KEK türetilir:
  new_kek_salt := random(16B)
  new_KEK := Argon2id(new_master_password, new_kek_salt, params)
  # Yeni keypair üretilir:
  (new_pub, new_priv) := X25519_keypair()
  new_priv_enc := AES-GCM-encrypt(new_priv, new_KEK, aad="user:<id>:privkey")
  
  Server'a: { new_kek_salt, new_kek_params, new_public_key, new_priv_enc }
```

**Kritik sonuç:** Kullanıcı recovery code ile kurtarıldığında:
- **Yeni keypair** üretilir.
- Eski keypair ile wrap edilmiş **item_shares'lerdeki tüm DEK'lere erişim kaybedilir**.
- Bu veri kaybı DEĞİL (item'lar duruyor), ama **o user artık o item'ları açamaz**.
- Paylaşımlı item'lar için: Diğer sahipler kullanıcıyı yeniden paylaşıma ekleyebilir. Owner + solo item'lar kalıcı kayıp.

Bu risk UI'da **çok belirgin şekilde uyarılır**: "Recovery code = yeniden erişim, ama solo item'larınız kaybolacak".

### 10. Log'lama Kısıtları

- **Master password, master key, DEK, private key** asla log'lanmaz. HTTP middleware request body'sinden `master_password`, `totp_code` gibi field'ları redact eder.
- Panic/error log'ları `bytea` alanları hex'in sadece ilk 8 byte'ını gösterir (`deadbeef...`) veya `[redacted 48B]`.
- Structured log'da secret alan göndermek için özel tip kullanılır:
  ```go
  type Secret []byte
  func (s Secret) LogValue() slog.Value { return slog.StringValue("[REDACTED]") }
  ```

## Alternatifler

### ChaCha20-Poly1305 vs AES-256-GCM
- ChaCha20: AES-NI olmayan CPU'larda daha hızlı, Rust ekosisteminde popüler.
- AES-GCM: FIPS uyumlu, AES-NI her modern CPU'da mevcut (server + desktop).
- **Karar: AES-GCM** — uzun vadeli enterprise uyumluluk.

### RSA-OAEP vs X25519
- RSA-4096: Geniş destek, 512B key, yavaş, padding oracle saldırı yüzeyi.
- X25519: Modern, 32B key, timing-safe, padding yok.
- **Karar: X25519**.

### Envelope encryption yerine doğrudan master_key ile şifreleme
- Reddedildi: Master key rotation için her satırı yeniden şifrelemek gerekir — O(N). Envelope ile sadece wrapped_dek yeniden wrap'lanır (DEK'ler sabit).

### Password Hashing: scrypt / bcrypt / Argon2id
- scrypt/bcrypt: Argon2'den önce standart, ama Argon2 daha modern ve ASIC-resistant.
- **Karar: Argon2id** (PHC winner, RFC 9106).

## Sonuçlar

### Olumlu
- Tüm kritik alanlar NIST/PHC/IRTF standartlarına uyumlu.
- Go stdlib + RustCrypto + libsodium gibi **iyi vetted** kütüphanelerle implementasyon.
- Key rotation hesaba katılmış — uzun vadeli sürdürülebilir.
- Known-answer test'ler yazılarak kripto correctness garanti edilir (Faz 2).

### Olumsuz / Risk
- **Mobile client** (ileride) Argon2id parametreleri ile yavaş kalabilir → onboarding'de kullanıcı 2-3sn bekler. Kabul edilebilir.
- **Recovery code + master password ikisi de kaybedilirse solo item'lar kalıcı kayıp.** UI'da prominent uyarı.
- **Searchable encryption frequency leak** — doc'lanmış, kabul edildi.
- **Revoke "future-only"** — revoked user T0 öncesi hafızasını kullanabilir. Sektör standardı.

### Nötr
- AAD kullanımı (row substitution savunması) ekstra dikkat ister — testlerle doğrulanır.
- Bu ADR **implementasyon değil tasarım**. Faz 2 (server crypto package) + Faz 4 (client crypto) sırasında detay sürprizi olursa bu ADR revize edilir (yeni version ADR-0004.2).

## Faz Sorumlulukları

| Faz | İş |
|-----|-----|
| **Faz 2** | `server/internal/crypto` implementasyonu (envelope, Argon2id verify, HMAC search, AAD) |
| **Faz 2** | Known-answer test'ler, property-based test (fuzz) |
| **Faz 4** | Client crypto (Rust veya TS): Argon2id KEK, X25519 sealed-box, AES-GCM, auto-lock |
| **Faz 5** | KMS entegrasyonu, master key rotation batch job |

## Referanslar

- RFC 9106 — Argon2
- RFC 8439 — ChaCha20-Poly1305
- RFC 5869 — HKDF
- RFC 7748 — X25519 / X448
- NIST SP 800-38D — AES-GCM
- NIST SP 800-132 — Password-Based Key Derivation
- libsodium docs — sealed boxes

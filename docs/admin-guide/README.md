# IronStock Admin Kılavuzu

## Giriş

Bu kılavuz IronStock sistem yöneticilerine yöneliktir. Kullanıcı yönetimi, güvenlik yapılandırması, izleme ve bakım işlemlerini kapsar.

## Kullanıcı Yönetimi

### Kullanıcı Oluşturma

Admin panelinden (`/admin/users`) yeni kullanıcı oluşturulabilir. Oluşturulan kullanıcı:
- İlk girişte şifre değiştirmek zorundadır (`must_change_password: true`)
- TOTP kurulumu zorunlu kılınabilir (`totp_required`)
- WebAuthn (donanım anahtarı) zorunlu kılınabilir (`webauthn_required`)

### Roller

| Rol | Yetkiler |
|-----|----------|
| `admin` | Tam yönetim: kullanıcı CRUD, audit log, export, K8s cluster, log forwarding, SSO, SCIM |
| `user` | Item CRUD (yalnızca erişim verilen klasör/item'lar), profil ayarları |

### Kullanıcı İşlemleri

- **Devre dışı bırakma:** Tüm aktif oturumlar anında sonlandırılır
- **Rol verme/alma:** Admin self-strip koruması (son admin kendini alamaz)
- **TOTP sıfırlama:** Kullanıcı telefonunu kaybettiğinde admin sıfırlayabilir
- **Break-glass:** Acil erişim hesabı oluşturma (audit + bildirim ile izlenir)

## Güvenlik Yapılandırması

### TOTP (Time-based One-Time Password)

Per-user TOTP zorunluluğu admin panelden ayarlanır:
- `PATCH /api/v1/admin/users/{id}/totp-required`
- Zorunlu kılınan kullanıcı bir sonraki girişte TOTP kurulum sihirbazını görür

### WebAuthn / FIDO2

Donanım güvenlik anahtarı (YubiKey, vb.) zorunluluğu:
- `PATCH /api/v1/admin/users/{id}/webauthn-required`
- Kullanıcı profil sayfasından anahtar kaydedebilir

### mTLS İstemci Sertifikaları

1. CA sertifikası yükle veya built-in CA kullan
2. Kullanıcı için sertifika oluştur (`/admin/client-certs`)
3. `cert_required` flag'ini etkinleştir
4. Tauri masaüstü istemcisinde .p12 dosyasını yapılandır

### IP Kısıtlamaları

Per-user IP whitelist ve ülke kısıtlaması:
- CIDR aralıkları (ör. `10.0.0.0/8`)
- Ülke kodları (ör. `TR`, `DE`)
- Tor çıkış düğümü engelleme
- GeoIP veritabanı otomatik güncellenir (24 saat cache)

### SSO / LDAP / OIDC

Admin panelden SSO sağlayıcı yapılandırması:
1. Sağlayıcı tipi seçin (LDAP, OIDC)
2. Bağlantı bilgilerini girin
3. Test bağlantısı çalıştırın
4. Aktifleştirin

SCIM 2.0 ile otomatik kullanıcı provisioning desteklenir.

## Audit Log

Tüm işlemler (auth, CRUD, admin aksiyonları) audit log'a kaydedilir.

### Sorgu Filtreleri

- Kullanıcı ID
- İşlem türü (action)
- Kaynak tipi (resource_type)
- Tarih aralığı
- IP adresi
- User agent

### Log Yönlendirme

Audit log'lar dış sistemlere yönlendirilebilir:

| Hedef | Protokol |
|-------|----------|
| Syslog | RFC 5424 (TCP/UDP) |
| Splunk | HTTP Event Collector (HEC) |
| Elastic | Bulk API (ECS format) |

Yapılandırma: Admin paneli → Log Yönlendirme

## K8s Cluster Yönetimi

Admin panelden Kubernetes cluster'lar eklenebilir:
- Kubeconfig ile bağlantı
- Per-item canlı K8s verisi proxy'si
- HTML envanter raporu oluşturma
- Bağlantı testi

## Export

### JSON Export
Tüm item'lar (admin) veya erişilebilir item'lar (kullanıcı) JSON formatında export edilebilir.

### Şifreli ZIP Export
Admin panelden kapsam seçilerek (tümü / klasör / kullanıcı) şifreli ZIP indirilebilir. ZIP içeriği:
- `manifest.json` — versiyon, kapsam, sayılar
- `items.json` — şifreli item verileri
- `shares.json` — paylaşım bilgileri
- `keypairs.json` — kullanıcı keypair'leri

## Bakım

### Credential Sağlık İzleme

- Süresi dolmak üzere olan credential'lar otomatik taranır (saatlik)
- Sağlık skoru: şifre yaşı, rotation sıklığı, karmaşıklık
- Prometheus metrikleri: `ironstock_credentials_expiring_total`, `ironstock_items_unhealthy_total`

### Secret Scanning

API token ile dış sistemlerden (GitHub, GitLab, CI/CD) IronStock credential'larının sızdırılıp sızdırılmadığı kontrol edilebilir:
- SHA-256 parmak izi karşılaştırması
- Admin panelden tespit edilen sızıntılar görüntülenebilir ve onaylanabilir

### Performans İzleme

- Prometheus metrikleri: `/metrics`
- pprof profiling: `ENVANTER_PPROF_ENABLED=true` → `/debug/pprof/`
- pg_stat_statements: N+1 sorgu tespiti
- SLO hedefleri: [docs/ops/slo.md](../ops/slo.md)

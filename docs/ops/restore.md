# IronStock Geri Yükleme Kılavuzu

## Ön Koşullar

1. API sunucusu durdurulmuş olmalı
2. Hedef PostgreSQL çalışıyor olmalı
3. `ENVANTER_MASTER_KEY` mevcut olmalı (yedekten ayrı saklanır)
4. Yedek arşivi erişilebilir olmalı

## Geri Yükleme Adımları

### 1. API Sunucusunu Durdur

```bash
# Kubernetes
kubectl scale deployment ironstock-api --replicas=0 -n ironstock

# Docker Compose
docker compose stop api

# Systemd
systemctl stop ironstock-api
```

### 2. Geri Yükle

```bash
# Lokal arşivden
./scripts/restore.sh /var/backups/ironstock/ironstock-backup-20260101-020000.tar.gz

# S3'ten
./scripts/restore.sh --from-s3 s3://my-backups/ironstock-backup-20260101-020000.tar.gz
```

Script şu adımları otomatik uygular:
1. Arşivi açar
2. Manifest'i gösterir
3. Onay ister
4. `pg_dump` çıktısını PostgreSQL'e yükler (`--clean --if-exists`)
5. MinIO bucket'ını geri yükler (varsa)

### 3. Master Key'i Doğrula

```bash
# Mevcut ortam değişkeninin doğru olduğundan emin olun
echo $ENVANTER_MASTER_KEY | base64 -d | wc -c
# Çıktı: 32 (32 byte = 256 bit)
```

### 4. API Sunucusunu Başlat

```bash
# Kubernetes
kubectl scale deployment ironstock-api --replicas=2 -n ironstock

# Docker Compose
docker compose up -d api
```

### 5. Doğrulama

```bash
# Readiness probe
curl -s http://localhost:8080/readyz
# Beklenen: {"status":"ok"}

# Admin girişi
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}'

# Item sayısı kontrolü
curl -s http://localhost:8080/api/v1/items \
  -H "Authorization: Bearer <token>" | jq 'length'
```

## Felaket Senaryoları

### Senaryo 1: Veritabanı Kaybı

1. Yeni PostgreSQL instance başlat
2. Extension'ları oluştur: `CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
3. `./scripts/restore.sh <archive>`
4. API sunucusunu yeni DB URL ile başlat

### Senaryo 2: Master Key Kaybı

**KRİTİK:** Master key olmadan şifreli veriler çözülemez.

Kurtarma seçenekleri:
- HSM/Vault'tan key'i al
- Kağıt escrow'dan QR kod oku
- **Son çare:** Yeni master key oluştur, tüm kullanıcılar şifrelerini değiştirmeli (keypair yeniden üretilir)

### Senaryo 3: Tam Cluster Kaybı

1. Yeni K8s cluster kur
2. Secret'ları yeniden oluştur (master key, JWT secret, DB URL)
3. PostgreSQL deploy et
4. `./scripts/restore.sh <archive>`
5. API + web deploy et
6. DNS/Ingress güncelle

### Senaryo 4: MinIO Kaybı

Dosya ekleri kaybedilir ama core işlevsellik etkilenmez:
1. Yeni MinIO instance başlat
2. `mc mirror` ile yedekten geri yükle (varsa)
3. `ENVANTER_MINIO_*` env var'larını güncelle

## Geri Yükleme Doğrulama Kontrol Listesi

- [ ] `/readyz` 200 döndürüyor
- [ ] Admin hesabıyla giriş yapılabiliyor
- [ ] Item'lar listelenebiliyor
- [ ] Şifreli field değerleri çözülebiliyor (E2E şifreleme çalışıyor)
- [ ] WebSocket bağlantısı kuruluyor
- [ ] Audit log geçmişi mevcut
- [ ] Dosya ekleri indirilebiliyor (MinIO)

## Zamanlama Hedefleri

| Metrik | Hedef |
|--------|--------|
| RTO (Recovery Time Objective) | < 30 dakika |
| RPO (Recovery Point Objective) | < 24 saat (günlük yedek) |
| Doğrulama süresi | < 15 dakika |

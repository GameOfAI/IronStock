# IronStock Yedekleme Kılavuzu

## Genel Bakış

IronStock yedekleme sistemi 3 bileşenden oluşur:

1. **PostgreSQL dump** — veritabanı (şifreli field değerleri dahil)
2. **MinIO bucket mirror** — dosya ekleri
3. **Master key** — şifreleme anahtarı (ayrı saklanmalı!)

## Yedekleme

### Manuel Yedekleme

```bash
# Tüm bileşenler
./scripts/backup.sh

# Sadece veritabanı
./scripts/backup.sh --db-only

# S3'e de yükle
S3_BUCKET=my-backups ./scripts/backup.sh --s3-upload
```

### Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `BACKUP_DIR` | `/var/backups/ironstock` | Yedek dizini |
| `ENVANTER_DB_URL` | — | PostgreSQL bağlantı dizesi |
| `MINIO_ALIAS` | `ironstock` | mc alias adı |
| `MINIO_BUCKET` | `envanter` | MinIO bucket |
| `S3_BUCKET` | — | S3 hedef bucket |
| `RETENTION_DAYS` | `30` | Eski yedekleri temizle |

### Yedek Formatı

```
ironstock-backup-YYYYMMDD-HHMMSS.tar.gz
├── manifest.json      # Yedek metadata
├── db.sql.gz          # PostgreSQL dump (gzip)
└── minio/             # MinIO bucket içeriği
```

### Kubernetes CronJob

Günlük otomatik yedekleme (`deploy/k8s/cronjob-backup.yaml`):

```bash
kubectl apply -f deploy/k8s/cronjob-backup.yaml
```

- Çalışma zamanı: her gün 02:00 UTC
- Retention: 30 gün
- Storage: 10Gi PVC

### Yedek Doğrulama

```bash
# Arşiv içeriğini kontrol et
tar -tzf ironstock-backup-20260101-020000.tar.gz

# Manifest oku
tar -xzf backup.tar.gz --to-stdout '*/manifest.json' | jq .
```

## Master Key Yönetimi

**KRİTİK:** Master key yedekten ayrı saklanmalıdır!

Master key olmadan:
- Veritabanı geri yüklenebilir ama şifreli field değerleri çözülemez
- Kullanıcı keypair'leri kullanılamaz
- Item'lar erişilemez hale gelir

### Önerilen Saklama

| Yöntem | Açıklama |
|--------|----------|
| Hardware Security Module (HSM) | En güvenli — üretim ortamı için |
| HashiCorp Vault | Sealed storage + audit trail |
| Kubecon Sealed Secrets | K8s cluster içinde şifreli |
| Kağıt escrow | QR kod yazdırılıp kasada saklanır |

### Key Rotation

Master key rotation henüz uygulanmamıştır. Planlanıyor:
1. Yeni key ile tüm wrapped DEK'leri yeniden wrap et
2. Eski key'i belirli süre paralel tut
3. Migration tamamlanınca eski key'i pasifleştir

## Yedekleme Stratejisi Önerileri

| Ortam | Sıklık | Retention | S3 |
|-------|--------|-----------|-----|
| Geliştirme | Haftalık | 7 gün | Hayır |
| Staging | Günlük | 14 gün | Opsiyonel |
| Üretim | Günlük + saatlik WAL | 90 gün | Evet |

### WAL Archiving (Üretim)

Point-in-time recovery için PostgreSQL WAL archiving önerilir:

```
# postgresql.conf
archive_mode = on
archive_command = 'cp %p /archive/%f'
wal_level = replica
```

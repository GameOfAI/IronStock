#!/usr/bin/env bash
# IronStock Backup Script
#
# PostgreSQL dump + MinIO bucket mirror + S3 upload (opsiyonel).
# Kullanım:
#   ./scripts/backup.sh                    # Tüm bileşenleri yedekle
#   ./scripts/backup.sh --db-only          # Sadece DB
#   ./scripts/backup.sh --s3-upload        # S3'e de yükle
#
# Ortam değişkenleri:
#   BACKUP_DIR          — yedek dizini (varsayılan: /var/backups/ironstock)
#   ENVANTER_DB_URL     — PostgreSQL bağlantı dizesi
#   MINIO_ALIAS         — mc alias adı (varsayılan: ironstock)
#   MINIO_BUCKET        — MinIO bucket (varsayılan: envanter)
#   S3_BUCKET           — S3 hedef bucket (opsiyonel, --s3-upload ile)
#   RETENTION_DAYS      — eski yedekleri temizle (varsayılan: 30)
#
# Çıkış kodları:
#   0 — başarılı
#   1 — pg_dump hatası
#   2 — MinIO mirror hatası
#   3 — S3 upload hatası

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/ironstock}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MINIO_ALIAS="${MINIO_ALIAS:-ironstock}"
MINIO_BUCKET="${MINIO_BUCKET:-envanter}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_NAME="ironstock-backup-${TIMESTAMP}"

DB_ONLY=false
S3_UPLOAD=false

for arg in "$@"; do
  case "$arg" in
    --db-only) DB_ONLY=true ;;
    --s3-upload) S3_UPLOAD=true ;;
    *) echo "Bilinmeyen parametre: $arg"; exit 1 ;;
  esac
done

mkdir -p "${BACKUP_DIR}/${BACKUP_NAME}"
echo "[$(date -u +%H:%M:%S)] Yedekleme başlıyor: ${BACKUP_NAME}"

# --- PostgreSQL Dump ---
echo "[$(date -u +%H:%M:%S)] PostgreSQL dump alınıyor..."
DB_DUMP="${BACKUP_DIR}/${BACKUP_NAME}/db.sql.gz"

if ! pg_dump "${ENVANTER_DB_URL}" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  | gzip > "${DB_DUMP}"; then
  echo "HATA: pg_dump başarısız oldu" >&2
  exit 1
fi

DB_SIZE=$(du -sh "${DB_DUMP}" | cut -f1)
echo "[$(date -u +%H:%M:%S)] DB dump tamamlandı: ${DB_SIZE}"

# --- MinIO Bucket Mirror ---
if [ "$DB_ONLY" = false ]; then
  echo "[$(date -u +%H:%M:%S)] MinIO bucket mirror başlıyor..."
  MINIO_DIR="${BACKUP_DIR}/${BACKUP_NAME}/minio"
  mkdir -p "${MINIO_DIR}"

  if command -v mc &> /dev/null; then
    if ! mc mirror --quiet "${MINIO_ALIAS}/${MINIO_BUCKET}" "${MINIO_DIR}/"; then
      echo "UYARI: MinIO mirror başarısız oldu" >&2
      # Fatal değil — DB dump zaten alındı
    else
      MINIO_SIZE=$(du -sh "${MINIO_DIR}" | cut -f1)
      echo "[$(date -u +%H:%M:%S)] MinIO mirror tamamlandı: ${MINIO_SIZE}"
    fi
  else
    echo "UYARI: mc (MinIO Client) bulunamadı — MinIO mirror atlandı" >&2
  fi
fi

# --- Metadata ---
cat > "${BACKUP_DIR}/${BACKUP_NAME}/manifest.json" <<MANIFEST
{
  "version": 1,
  "timestamp": "${TIMESTAMP}",
  "components": {
    "database": "db.sql.gz",
    "minio": "minio/"
  },
  "db_url_host": "$(echo "${ENVANTER_DB_URL}" | sed 's|.*@||;s|/.*||')",
  "hostname": "$(hostname)",
  "retention_days": ${RETENTION_DAYS}
}
MANIFEST

# --- Arşivleme ---
echo "[$(date -u +%H:%M:%S)] Arşiv oluşturuluyor..."
ARCHIVE="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
tar -czf "${ARCHIVE}" -C "${BACKUP_DIR}" "${BACKUP_NAME}"
rm -rf "${BACKUP_DIR}/${BACKUP_NAME}"

ARCHIVE_SIZE=$(du -sh "${ARCHIVE}" | cut -f1)
echo "[$(date -u +%H:%M:%S)] Arşiv: ${ARCHIVE} (${ARCHIVE_SIZE})"

# --- S3 Upload (opsiyonel) ---
if [ "$S3_UPLOAD" = true ] && [ -n "${S3_BUCKET:-}" ]; then
  echo "[$(date -u +%H:%M:%S)] S3'e yükleniyor: s3://${S3_BUCKET}/"
  if ! aws s3 cp "${ARCHIVE}" "s3://${S3_BUCKET}/${BACKUP_NAME}.tar.gz" \
    --storage-class STANDARD_IA; then
    echo "HATA: S3 upload başarısız oldu" >&2
    exit 3
  fi
  echo "[$(date -u +%H:%M:%S)] S3 upload tamamlandı"
fi

# --- Eski Yedekleri Temizle ---
echo "[$(date -u +%H:%M:%S)] ${RETENTION_DAYS} günden eski yedekler temizleniyor..."
find "${BACKUP_DIR}" -name "ironstock-backup-*.tar.gz" -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true

echo "[$(date -u +%H:%M:%S)] Yedekleme tamamlandı: ${ARCHIVE}"

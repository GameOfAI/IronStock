#!/usr/bin/env bash
# IronStock Restore Script
#
# Yedekten geri yükleme: PostgreSQL + MinIO.
# Kullanım:
#   ./scripts/restore.sh /path/to/ironstock-backup-YYYYMMDD-HHMMSS.tar.gz
#   ./scripts/restore.sh --from-s3 s3://bucket/ironstock-backup-20260101-120000.tar.gz
#
# Ortam değişkenleri:
#   ENVANTER_DB_URL     — hedef PostgreSQL bağlantı dizesi
#   MINIO_ALIAS         — mc alias adı (varsayılan: ironstock)
#   MINIO_BUCKET        — MinIO bucket (varsayılan: envanter)
#
# ÖNEMLİ: Bu script mevcut veritabanını SİLER ve yedeği yükler.
#          Çalıştırmadan önce API sunucusunu durdurun.
#
# Çıkış kodları:
#   0 — başarılı
#   1 — parametre hatası
#   2 — geri yükleme hatası

set -euo pipefail

MINIO_ALIAS="${MINIO_ALIAS:-ironstock}"
MINIO_BUCKET="${MINIO_BUCKET:-envanter}"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

FROM_S3=false
ARCHIVE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-s3)
      FROM_S3=true
      shift
      ;;
    *)
      ARCHIVE="$1"
      shift
      ;;
  esac
done

if [ -z "${ARCHIVE}" ]; then
  echo "Kullanım: $0 [--from-s3] <archive-path-or-s3-uri>" >&2
  exit 1
fi

# --- Arşivi İndir (S3) veya Kopyala ---
if [ "$FROM_S3" = true ]; then
  echo "[$(date -u +%H:%M:%S)] S3'ten indiriliyor: ${ARCHIVE}"
  LOCAL_ARCHIVE="${WORK_DIR}/backup.tar.gz"
  aws s3 cp "${ARCHIVE}" "${LOCAL_ARCHIVE}"
else
  LOCAL_ARCHIVE="${ARCHIVE}"
fi

if [ ! -f "${LOCAL_ARCHIVE}" ]; then
  echo "HATA: Arşiv dosyası bulunamadı: ${LOCAL_ARCHIVE}" >&2
  exit 1
fi

# --- Arşivi Aç ---
echo "[$(date -u +%H:%M:%S)] Arşiv açılıyor..."
tar -xzf "${LOCAL_ARCHIVE}" -C "${WORK_DIR}"

BACKUP_DIR=$(find "${WORK_DIR}" -maxdepth 1 -name "ironstock-backup-*" -type d | head -1)
if [ -z "${BACKUP_DIR}" ]; then
  echo "HATA: Arşiv içinde ironstock-backup-* dizini bulunamadı" >&2
  exit 1
fi

echo "[$(date -u +%H:%M:%S)] Yedek dizini: $(basename "${BACKUP_DIR}")"

# --- Manifest Kontrol ---
if [ -f "${BACKUP_DIR}/manifest.json" ]; then
  echo "[$(date -u +%H:%M:%S)] Manifest:"
  cat "${BACKUP_DIR}/manifest.json"
  echo ""
fi

# --- Kullanıcı Onayı ---
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  UYARI: Bu işlem mevcut veritabanını SİLECEKTİR!    ║"
echo "║  API sunucusunun durdurulduğundan emin olun.        ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
read -r -p "Devam etmek istiyor musunuz? (evet/hayır): " CONFIRM
if [ "${CONFIRM}" != "evet" ]; then
  echo "İptal edildi."
  exit 0
fi

# --- PostgreSQL Restore ---
DB_DUMP="${BACKUP_DIR}/db.sql.gz"
if [ -f "${DB_DUMP}" ]; then
  echo "[$(date -u +%H:%M:%S)] PostgreSQL geri yükleniyor..."
  if ! gunzip -c "${DB_DUMP}" | psql "${ENVANTER_DB_URL}" --quiet; then
    echo "HATA: PostgreSQL geri yükleme başarısız oldu" >&2
    exit 2
  fi
  echo "[$(date -u +%H:%M:%S)] PostgreSQL geri yükleme tamamlandı"
else
  echo "UYARI: DB dump dosyası bulunamadı, atlanıyor" >&2
fi

# --- MinIO Restore ---
MINIO_DIR="${BACKUP_DIR}/minio"
if [ -d "${MINIO_DIR}" ] && [ "$(ls -A "${MINIO_DIR}" 2>/dev/null)" ]; then
  echo "[$(date -u +%H:%M:%S)] MinIO bucket geri yükleniyor..."
  if command -v mc &> /dev/null; then
    mc mirror --overwrite --quiet "${MINIO_DIR}/" "${MINIO_ALIAS}/${MINIO_BUCKET}"
    echo "[$(date -u +%H:%M:%S)] MinIO geri yükleme tamamlandı"
  else
    echo "UYARI: mc (MinIO Client) bulunamadı — MinIO geri yükleme atlandı" >&2
  fi
else
  echo "[$(date -u +%H:%M:%S)] MinIO yedek verisi yok, atlanıyor"
fi

echo ""
echo "[$(date -u +%H:%M:%S)] Geri yükleme tamamlandı!"
echo ""
echo "Sonraki adımlar:"
echo "  1. API sunucusunu başlatın"
echo "  2. /readyz endpoint'ini kontrol edin"
echo "  3. Admin hesabıyla giriş yapıp verileri doğrulayın"
echo "  4. Master key'in doğru olduğundan emin olun (ENVANTER_MASTER_KEY)"

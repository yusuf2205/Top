#!/usr/bin/env bash
# Restores a given backup timestamp into a target database/bucket.
# Usage: restore.sh <timestamp> [target_db] [target_bucket]
# Defaults to restoring INTO the production db/bucket — always pass an explicit
# target_db/target_bucket when testing (see restore-test.sh), never run this
# bare against production unless you actually intend to overwrite it.
set -euo pipefail

BACKUP_TS="${1:?Usage: restore.sh <timestamp> [target_db] [target_bucket]}"
TARGET_DB="${2:-${POSTGRES_DB}}"
TARGET_BUCKET="${3:-${S3_BUCKET}}"
BACKUP_DIR="/backups/${BACKUP_TS}"

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "[restore] ERROR: no backup found at ${BACKUP_DIR}" >&2
  exit 1
fi

echo "[restore] Restoring PostgreSQL dump into database '${TARGET_DB}'..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore -h postgres -U "${POSTGRES_USER}" -d "${TARGET_DB}" \
  --clean --if-exists --no-owner "${BACKUP_DIR}/postgres.dump"

echo "[restore] Restoring MinIO documents into bucket '${TARGET_BUCKET}'..."
TARGET_REMOTE=":s3,provider=Minio,access_key_id=${S3_ACCESS_KEY},secret_access_key=${S3_SECRET_KEY},endpoint=${S3_ENDPOINT},force_path_style=true:${TARGET_BUCKET}"
rclone mkdir "${TARGET_REMOTE}" 2>/dev/null || true
rclone sync "${BACKUP_DIR}/minio/" "${TARGET_REMOTE}" --create-empty-src-dirs

echo "[restore] Done."

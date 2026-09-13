#!/usr/bin/env bash
# Daily backup: PostgreSQL dump + MinIO document mirror -> local copy (SATA pool,
# backup_data volume) -> every configured offsite target.
# See FINAL-INFRASTRUCTURE-ARCHITECTURE.md §E (Backup Architecture) for the design.
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/backups/${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

# On-the-fly rclone remote pointing at MinIO — no config file, no separate `mc`
# binary (MinIO's own client download turned out to be dead, same story as
# minio/minio on Docker Hub — see backup.Dockerfile). One rclone connection-string
# convention is reused by restore.sh/restore-test.sh too.
MINIO_REMOTE=":s3,provider=Minio,access_key_id=${S3_ACCESS_KEY},secret_access_key=${S3_SECRET_KEY},endpoint=${S3_ENDPOINT},force_path_style=true:${S3_BUCKET}"

echo "[backup] Dumping PostgreSQL database '${POSTGRES_DB}'..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -F custom -f "${BACKUP_DIR}/postgres.dump"

echo "[backup] Mirroring MinIO bucket '${S3_BUCKET}'..."
mkdir -p "${BACKUP_DIR}/minio"
rclone sync "${MINIO_REMOTE}" "${BACKUP_DIR}/minio/" --create-empty-src-dirs

echo "[backup] Pushing to configured targets: ${BACKUP_TARGETS:-local}"
IFS=',' read -ra TARGETS <<< "${BACKUP_TARGETS:-local}"
for target in "${TARGETS[@]}"; do
  script="/backup/targets/${target}.sh"
  if [[ -f "${script}" ]]; then
    echo "[backup] -> target: ${target}"
    bash "${script}" "${BACKUP_DIR}"
  else
    echo "[backup] WARNING: unknown backup target '${target}' (no ${script}) — skipping" >&2
  fi
done

echo "[backup] Applying retention policy..."
bash /backup/retention.sh

echo "[backup] Done: ${BACKUP_DIR}"

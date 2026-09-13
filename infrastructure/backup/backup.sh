#!/usr/bin/env bash
# Daily backup: PostgreSQL dump + MinIO document mirror -> local copy (SATA pool,
# backup_data volume) -> every configured offsite target.
# See FINAL-INFRASTRUCTURE-ARCHITECTURE.md §E (Backup Architecture) for the design.
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/backups/${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

# rclone talks to MinIO with no config file: `--s3-*` flags configure an anonymous
# "s3"-type backend for this one invocation, referenced as `:s3:bucket`. (No separate
# `mc` binary — MinIO's own client download turned out to be dead, same story as
# minio/minio on Docker Hub — see backup.Dockerfile. Also no inline connection-string
# remote (":s3,endpoint=...:bucket") — rclone's parser mishandles the "://" inside an
# endpoint value there; confirmed on the NAS.) restore.sh reuses this flag set.
RCLONE_S3_FLAGS=(
  --s3-provider=Minio
  --s3-access-key-id="${S3_ACCESS_KEY}"
  --s3-secret-access-key="${S3_SECRET_KEY}"
  --s3-endpoint="${S3_ENDPOINT}"
  --s3-force-path-style
)

echo "[backup] Dumping PostgreSQL database '${POSTGRES_DB}'..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -F custom -f "${BACKUP_DIR}/postgres.dump"

echo "[backup] Mirroring MinIO bucket '${S3_BUCKET}'..."
mkdir -p "${BACKUP_DIR}/minio"
rclone sync ":s3:${S3_BUCKET}" "${BACKUP_DIR}/minio/" "${RCLONE_S3_FLAGS[@]}" --create-empty-src-dirs

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

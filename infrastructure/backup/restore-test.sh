#!/usr/bin/env bash
# Mandatory restore rehearsal — FINAL-INFRASTRUCTURE-ARCHITECTURE.md p.17 / M0 Definition
# of Done: "a backup that was never restored is not a backup."
#
#   read baseline from the live DB -> backup it -> restore into a throwaway DB -> verify
#
# Deliberately does NOT use `CREATE DATABASE ... TEMPLATE <live db>` — Postgres refuses
# that while there are active connections to the template (which there always will be:
# api/worker hold an open pool to it), and more importantly, restoring a backup into a
# fresh database is the actual disaster-recovery scenario this rehearses, not cloning
# the live DB.
#
# Run this: (a) once, manually, before go-live (M0 Definition of Done), and
# (b) monthly thereafter (cron it via the same mechanism as backup.sh).
# Exits non-zero on any mismatch — wire that into monitoring/alerting once top-status
# (or its Phase-2 replacement) can run scheduled checks, not just container health.
set -euo pipefail

TEST_DB="top_restore_test"
TEST_BUCKET="top-documents-restore-test"
CHECK_QUERY="SELECT count(*) FROM organizations;"

echo "[restore-test] 1/5 Reading baseline row count from '${POSTGRES_DB}'..."
BEFORE=$(PGPASSWORD="${POSTGRES_PASSWORD}" psql -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -t -c "${CHECK_QUERY}" | tr -d '[:space:]')

echo "[restore-test] 2/5 Running backup.sh..."
BACKUP_OUTPUT=$(bash /backup/backup.sh)
echo "${BACKUP_OUTPUT}"
BACKUP_TS=$(basename "$(echo "${BACKUP_OUTPUT}" | grep '^\[backup\] Done:' | awk '{print $NF}')")

echo "[restore-test] 3/5 Creating throwaway empty test database '${TEST_DB}'..."
PGPASSWORD="${POSTGRES_PASSWORD}" psql -h postgres -U "${POSTGRES_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${TEST_DB};"
PGPASSWORD="${POSTGRES_PASSWORD}" psql -h postgres -U "${POSTGRES_USER}" -d postgres \
  -c "CREATE DATABASE ${TEST_DB};"

echo "[restore-test] 4/5 Restoring backup ${BACKUP_TS} into '${TEST_DB}' / '${TEST_BUCKET}'..."
bash /backup/restore.sh "${BACKUP_TS}" "${TEST_DB}" "${TEST_BUCKET}"

echo "[restore-test] 5/5 Verifying row count..."
AFTER=$(PGPASSWORD="${POSTGRES_PASSWORD}" psql -h postgres -U "${POSTGRES_USER}" -d "${TEST_DB}" -t -c "${CHECK_QUERY}" | tr -d '[:space:]')

PGPASSWORD="${POSTGRES_PASSWORD}" psql -h postgres -U "${POSTGRES_USER}" -d postgres \
  -c "DROP DATABASE ${TEST_DB};"

if [[ "${BEFORE}" == "${AFTER}" ]]; then
  echo "[restore-test] PASS — row count matches before/after (${BEFORE})."
  exit 0
else
  echo "[restore-test] FAIL — row count mismatch (before=${BEFORE}, after=${AFTER})." >&2
  exit 1
fi

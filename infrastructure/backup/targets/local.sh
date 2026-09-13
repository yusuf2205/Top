#!/usr/bin/env bash
# Default backup target — the dump/mirror already lands on the SATA pool
# (backup_data volume) by the time this runs, so there is nothing further to push.
# This is the "local copy" leg of the 3-2-1 rule; it alone is NOT sufficient —
# add an offsite target (see offsite-s3.sh.example) once Open Decision #2 is resolved.
set -euo pipefail
BACKUP_DIR="$1"
echo "[backup:local] ${BACKUP_DIR} already on the local backup volume — nothing to push."

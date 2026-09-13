#!/usr/bin/env bash
# Grandfather-father-son retention over /backups/<YYYYMMDD-HHMMSS>/ directories:
# keep the 7 most recent, plus one per ISO week for the last 4 weeks, plus one per
# calendar month for the last 3 months. Everything else is deleted.
# Deliberately simple (bash + date), not a dedicated backup tool — matches
# "minimum complexity" principle for MVP; revisit if retention rules grow more complex.
set -euo pipefail

cd /backups
mapfile -t ALL_DIRS < <(find . -maxdepth 1 -type d -name '[0-9]*-[0-9]*' -printf '%f\n' | sort -r)

if [[ ${#ALL_DIRS[@]} -eq 0 ]]; then
  echo "[retention] no backup directories found, nothing to do"
  exit 0
fi

KEEP=()
# 1) newest 7, unconditionally
for d in "${ALL_DIRS[@]:0:7}"; do KEEP+=("$d"); done

# 2) one per ISO week for the last 4 weeks
declare -A SEEN_WEEK
for d in "${ALL_DIRS[@]}"; do
  week=$(date -d "${d:0:8}" +%G-W%V 2>/dev/null) || continue
  if [[ -z "${SEEN_WEEK[$week]:-}" ]]; then
    SEEN_WEEK[$week]=1
    KEEP+=("$d")
  fi
done

# 3) one per month for the last 3 months
declare -A SEEN_MONTH
for d in "${ALL_DIRS[@]}"; do
  month="${d:0:6}"
  if [[ -z "${SEEN_MONTH[$month]:-}" ]]; then
    SEEN_MONTH[$month]=1
    KEEP+=("$d")
  fi
done

# de-dupe KEEP
mapfile -t KEEP_UNIQUE < <(printf '%s\n' "${KEEP[@]}" | sort -u)

for d in "${ALL_DIRS[@]}"; do
  if ! printf '%s\n' "${KEEP_UNIQUE[@]}" | grep -qx "$d"; then
    echo "[retention] deleting expired backup: $d"
    rm -rf "./${d:?}"
  fi
done

echo "[retention] kept ${#KEEP_UNIQUE[@]} of ${#ALL_DIRS[@]} backup directories"

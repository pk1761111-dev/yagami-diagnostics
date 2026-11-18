#!/bin/sh
# Database + payment-proof backup. Runs inside the compose "backup" service,
# or manually: PGPASSWORD=... sh scripts/backup.sh
set -eu
TS=$(date +%Y-%m-%d_%H%M)
OUT=${BACKUP_DIR:-/backups}
mkdir -p "$OUT"
pg_dump -h "${PGHOST:-db}" -U "${PGUSER:-yagami}" -d "${PGDATABASE:-yagami_crm}" -Fc -f "$OUT/yagami_crm_$TS.dump"
if [ -d /uploads ]; then tar -czf "$OUT/uploads_$TS.tar.gz" -C /uploads . ; fi
find "$OUT" -type f -mtime +"${KEEP_DAYS:-30}" -delete
echo "[backup] $TS done"
# Restore: pg_restore -h db -U yagami -d yagami_crm --clean --if-exists yagami_crm_<ts>.dump

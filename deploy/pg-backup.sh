#!/usr/bin/env bash
# Nightly Postgres dump -> Cloudflare R2 ("backup" bucket).
#
# Prerequisites on the EC2 box:
#   - postgresql-client (pg_dump, pg_restore) and awscli installed
#   - R2 API token (Object Read & Write on the "backup" bucket) from
#     Cloudflare dashboard -> R2 -> API tokens
#   - env file at /etc/college-attendance/pg-backup.env (see pg-backup.env.example),
#     owned by root with mode 600
#   - R2 lifecycle rule on the bucket: delete objects after 30 days
#     (dashboard -> R2 -> backup -> Settings -> Object lifecycle rules)
#
# Install cron (server clock is UTC; IST = UTC+5:30 — 19:00 UTC is 00:30 IST,
# clear of the 02:30 IST cache-warm and school hours):
#   0 19 * * * ubuntu /opt/college-attendance/deploy/pg-backup.sh >> /var/log/college-attendance/pg-backup.log 2>&1
#
# Restore drill (do this once on a throwaway database):
#   pg_restore --clean --if-exists -d <target-database-url> <file.dump>
set -euo pipefail

ENV_FILE="${PG_BACKUP_ENV:-/etc/college-attendance/pg-backup.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "pg-backup: env file not found: $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${DATABASE_URL:?DATABASE_URL is not set in $ENV_FILE}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is not set in $ENV_FILE}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is not set in $ENV_FILE}"
R2_ENDPOINT="${R2_ENDPOINT:-https://c3d2312bbd50a8326f44802de3e3b2df.r2.cloudflarestorage.com}"
R2_BUCKET="${R2_BUCKET:-backup}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/college-attendance}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="college_attendance_${STAMP}.dump"
LOCAL_PATH="${BACKUP_DIR}/${FILE}"

echo "pg-backup: dumping to ${LOCAL_PATH}"
pg_dump --format=custom --compress=9 --no-owner --dbname="$DATABASE_URL" --file="$LOCAL_PATH"

echo "pg-backup: validating dump"
pg_restore --list "$LOCAL_PATH" > /dev/null

echo "pg-backup: uploading to R2 (${R2_BUCKET}/${FILE})"
aws --endpoint-url "$R2_ENDPOINT" s3 cp "$LOCAL_PATH" "s3://${R2_BUCKET}/${FILE}" --only-show-errors

echo "pg-backup: pruning local copies older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -name 'college_attendance_*.dump' -mtime +"$RETENTION_DAYS" -delete

SIZE="$(du -h "$LOCAL_PATH" | cut -f1)"
echo "pg-backup: done (${FILE}, ${SIZE})"

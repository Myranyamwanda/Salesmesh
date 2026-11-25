#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_USER and $POSTGRES_DB expand inside the container.
# Back up the production database (pg_dump custom format) and keep 14 days.
#   scripts/backup.sh
# Daily at 02:15 server time (crontab -e as the deploy user):
#   15 2 * * * /opt/salesmesh/app/scripts/backup.sh >> /opt/salesmesh/backups/backup.log 2>&1
# Restore steps: docs/deployment.md, "Restore a backup".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/opt/salesmesh/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE=(docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT")

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

# The migration is part of the name: a restore needs the code of that migration.
migration="$("${COMPOSE[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select version_num from alembic_version"' | tr -d '[:space:]')"
file="$BACKUP_DIR/salesmesh-$(date +%Y%m%d-%H%M%S)-m${migration:-unknown}.dump"

"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$file.partial"

# A dump that pg_restore cannot list is not a backup.
if ! "${COMPOSE[@]}" exec -T postgres pg_restore -l < "$file.partial" > /dev/null; then
  rm -f "$file.partial"
  echo "$(date -Is) backup FAILED: pg_restore could not read the dump" >&2
  exit 1
fi
mv "$file.partial" "$file"

find "$BACKUP_DIR" -maxdepth 1 -name 'salesmesh-*.dump' -mtime +"$((KEEP_DAYS - 1))" -delete
echo "$(date -Is) backup ok: $file ($(du -h "$file" | cut -f1))"

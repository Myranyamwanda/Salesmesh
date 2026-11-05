#!/usr/bin/env bash
# Deploy or update SalesMesh on the production server.
#   scripts/deploy.sh             pull the current branch, build, start, check
#   scripts/deploy.sh v1.3.0-rc1  deploy a tag (also used to roll back)
#   scripts/deploy.sh --no-pull   build and start the code already checked out
# A database backup is taken first whenever the database is running.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.prod.yml)
REF="${1:-}"

[ -f .env ] || { echo "Missing $ROOT/.env (copy .env.production.example)." >&2; exit 1; }
[ -f backend/models/v1/model.joblib ] || { echo "Model files missing: run scripts/fetch-model.sh." >&2; exit 1; }
# Like Docker Compose, a DOMAIN in the environment wins over the one in .env.
DOMAIN="${DOMAIN:-$( (grep -E '^DOMAIN=' .env || true) | tail -n1 | cut -d= -f2- | tr -d '"'"'"'\r')}"
[ -n "$DOMAIN" ] || { echo "Set DOMAIN in .env." >&2; exit 1; }

if [ -n "$("${COMPOSE[@]}" ps -q postgres 2>/dev/null)" ]; then
  echo "== Backing up the database before the update"
  scripts/backup.sh
fi

if [ "$REF" != "--no-pull" ]; then
  echo "== Fetching code"
  git fetch --tags --prune origin
  if [ -n "$REF" ]; then
    git checkout --detach "$REF"
  elif git symbolic-ref -q HEAD > /dev/null; then
    git pull --ff-only
  else
    echo "HEAD is a detached tag; pass the tag or branch to deploy." >&2
    exit 1
  fi
fi
echo "== Deploying $(git describe --tags --always)"

# One image at a time keeps the build inside 2 GB of memory.
echo "== Building"
"${COMPOSE[@]}" build backend
"${COMPOSE[@]}" build web

echo "== Starting (migrations run when the backend starts)"
"${COMPOSE[@]}" up -d --wait --wait-timeout 300

echo "== Health check"
curl_opts=(-fsS --max-time 10)
[ "$DOMAIN" = "localhost" ] && curl_opts+=(--insecure)  # Caddy's local CA
health="$(curl "${curl_opts[@]}" "https://$DOMAIN/api/health")"
echo "$health"
case "$health" in
  *'"status":"ok"'*) echo "== Deployed and healthy: https://$DOMAIN" ;;
  *) echo "Health is not ok; see: docker compose -f docker-compose.prod.yml logs backend" >&2; exit 1 ;;
esac
docker image prune -f > /dev/null

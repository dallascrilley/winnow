#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/inbound-golden-test.XXXXXX")
CONTAINER="inbound-golden-test-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT

docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=inbound \
  -e POSTGRES_PASSWORD=example-password \
  postgres:16.9-alpine >/dev/null

for _ in {1..60}; do
  if docker exec "$CONTAINER" pg_isready -U inbound -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U inbound -d postgres >/dev/null

databases=(inbound_analytics inbound_dispatch inbound_forms inbound_qualify inbound_scheduler)
for database in "${databases[@]}"; do
  docker exec "$CONTAINER" createdb -U inbound "$database"
  docker exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U inbound -d "$database" \
    -c "CREATE TABLE proof_rows (id integer PRIMARY KEY, value text NOT NULL, email text, metadata jsonb); INSERT INTO proof_rows VALUES (1, 'synthetic-example', 'demo@example.com', '{\"owner\":\"demo@example.com\"}');" >/dev/null
done
docker exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U inbound -d inbound_qualify \
  -c "CREATE TABLE eval_runs (model text NOT NULL, prompt_hash text NOT NULL, created_at text NOT NULL); INSERT INTO eval_runs VALUES ('gpt-5-mini-2025-08-07', 'abcdef123456', '2026-07-18T00:00:00Z');" >/dev/null

POSTGRES_CONTAINER="$CONTAINER" \
BACKUP_OUTPUT_ROOT="$WORK/packages" \
BACKUP_LOCAL_ONLY=1 \
BACKUP_DATA_CLASSIFICATION=synthetic-demo-only \
APP_GIT_SHA="$(printf 'a%.0s' {1..40})" \
APP_IMAGE_REF="example.invalid/inbound@sha256:$(printf 'b%.0s' {1..64})" \
  "$ROOT/scripts/backup-golden-state.sh" >/dev/null

package_dir=$(find "$WORK/packages" -mindepth 1 -maxdepth 1 -type d -print -quit)
node "$ROOT/scripts/verify-golden-state.mjs" "$package_dir" >/dev/null

docker exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U inbound -d inbound_forms \
  -c "INSERT INTO proof_rows VALUES (2, 'must-not-back-up', 'person@private-company.co', '{}');" >/dev/null
if POSTGRES_CONTAINER="$CONTAINER" BACKUP_OUTPUT_ROOT="$WORK/rejected" BACKUP_LOCAL_ONLY=1 \
  BACKUP_DATA_CLASSIFICATION=synthetic-demo-only \
  APP_GIT_SHA="$(printf 'a%.0s' {1..40})" \
  APP_IMAGE_REF="example.invalid/inbound@sha256:$(printf 'b%.0s' {1..64})" \
  "$ROOT/scripts/backup-golden-state.sh" >/dev/null 2>&1; then
  echo "private visitor data was accepted for backup" >&2
  exit 1
fi
docker exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U inbound -d inbound_forms \
  -c "DELETE FROM proof_rows WHERE id = 2;" >/dev/null

cp -R "$package_dir" "$WORK/corrupt"
printf 'corrupt' >"$WORK/corrupt/inbound_dispatch.dump"
if POSTGRES_CONTAINER="$CONTAINER" RESTORE_PACKAGE_DIR="$WORK/corrupt" RESTORE_CONFIRM=replace-synthetic-databases \
  "$ROOT/scripts/restore-golden-state.sh" >/dev/null 2>&1; then
  echo "corrupt package was accepted" >&2
  exit 1
fi
marker=$(docker exec "$CONTAINER" psql -X -Atq -U inbound -d inbound_dispatch -c 'SELECT value FROM proof_rows WHERE id = 1')
[[ "$marker" == "synthetic-example" ]]

docker exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U inbound -d inbound_dispatch \
  -c "INSERT INTO proof_rows VALUES (2, 'must-be-removed');" >/dev/null

start_seconds=$SECONDS
POSTGRES_CONTAINER="$CONTAINER" RESTORE_PACKAGE_DIR="$package_dir" RESTORE_CONFIRM=replace-synthetic-databases \
  "$ROOT/scripts/restore-golden-state.sh" >/dev/null
elapsed=$((SECONDS - start_seconds))
[[ $elapsed -lt 900 ]]

count=$(docker exec "$CONTAINER" psql -X -Atq -U inbound -d inbound_dispatch -c 'SELECT count(*) FROM proof_rows')
[[ "$count" == 1 ]]
printf 'golden-state recovery test passed in %ss\n' "$elapsed"

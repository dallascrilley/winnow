#!/usr/bin/env bash
set -euo pipefail

DATABASES=(
  inbound_analytics
  inbound_dispatch
  inbound_forms
  inbound_qualify
  inbound_scheduler
)

OUTPUT_ROOT=${BACKUP_OUTPUT_ROOT:-/run/inbound-lite/backups}
S3_PREFIX=${BACKUP_PREFIX:-golden-state}
APP_GIT_SHA=${APP_GIT_SHA:?APP_GIT_SHA is required}
APP_IMAGE_REF=${APP_IMAGE_REF:?APP_IMAGE_REF is required}
AWS_REGION=${AWS_REGION:-us-east-1}
BACKUP_DATA_CLASSIFICATION=${BACKUP_DATA_CLASSIFICATION:-}

if [[ "$BACKUP_DATA_CLASSIFICATION" != "synthetic-demo-only" ]]; then
  echo "golden-state backup requires synthetic-demo-only classification" >&2
  exit 1
fi

if [[ ! "$APP_GIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid backup Git identity" >&2
  exit 1
fi
if [[ ! "$APP_IMAGE_REF" =~ @sha256:([0-9a-f]{64})$ ]]; then
  echo "invalid backup image identity" >&2
  exit 1
fi
image_digest="sha256:${BASH_REMATCH[1]}"

resolve_postgres_container() {
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    printf '%s\n' "$POSTGRES_CONTAINER"
    return
  fi
  docker compose \
    --env-file "${RUNTIME_ENV:-/run/inbound-lite/runtime.env}" \
    --project-directory "${INBOUND_ROOT:-/opt/inbound-lite}" \
    -f "${COMPOSE_FILE:-/opt/inbound-lite/compose.yaml}" \
    ps -q postgres
}

postgres_container=$(resolve_postgres_container)
if [[ ! "$postgres_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$ ]]; then
  echo "PostgreSQL container is unavailable" >&2
  exit 1
fi

created_at=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
package_id="$(date -u +%Y%m%dT%H%M%SZ)-${APP_GIT_SHA:0:12}"
install -d -m 0700 "$OUTPUT_ROOT"
lock_dir="$OUTPUT_ROOT/.backup-lock"
if ! mkdir "$lock_dir"; then
  echo "golden-state backup is already running" >&2
  exit 1
fi
package_dir="$OUTPUT_ROOT/$package_id"
install -d -m 0700 "$package_dir"
umask 077

cleanup_failed_package() {
  rmdir "$lock_dir" 2>/dev/null || true
  if [[ ${backup_complete:-0} != 1 ]]; then
    rm -rf -- "$package_dir"
  fi
}
trap cleanup_failed_package EXIT

eval_metadata=$(docker exec -i "$postgres_container" psql -X -v ON_ERROR_STOP=1 -Atq \
  -U inbound -d inbound_qualify \
  -c "SELECT model || E'\\t' || prompt_hash FROM eval_runs ORDER BY created_at DESC LIMIT 1")
IFS=$'\t' read -r eval_model eval_prompt_hash <<<"$eval_metadata"
if [[ ! "$eval_model" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] ||
  [[ ! "$eval_prompt_hash" =~ ^[0-9a-f]{12}([0-9a-f]{52})?$ ]]; then
  echo "verified eval metadata is unavailable" >&2
  exit 1
fi

databases_json='[]'
for database in "${DATABASES[@]}"; do
  archive="$database.dump"
  row_counts="$database.rows.tsv"

  private_email_flags=$({
    printf '%s\n' '\pset tuples_only on' '\pset format unaligned'
    printf "%s\n" "SELECT format('SELECT CASE WHEN EXISTS (SELECT 1 FROM %I.%I source_row WHERE EXISTS (SELECT 1 FROM regexp_matches(source_row.%I::text, %L, ''gi'') matched WHERE matched[1] !~* %L)) THEN 1 ELSE 0 END;', table_schema, table_name, column_name, '([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})', '@([A-Z0-9.-]+\\.)?(test|invalid)$|@example\\.(com|org|net)$') FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'character', 'json', 'jsonb') ORDER BY table_name, ordinal_position;"
    printf '%s\n' '\gexec'
  } | docker exec -i "$postgres_container" psql -X -v ON_ERROR_STOP=1 -Atq \
    -U inbound -d "$database")
  if grep -qx '1' <<<"$private_email_flags"; then
    echo "golden-state source is not synthetic-only: $database" >&2
    exit 1
  fi

  if ! docker exec -i "$postgres_container" pg_dump -U inbound -Fc \
    --no-owner --no-privileges "$database" >"$package_dir/$archive"; then
    echo "golden-state dump failed for $database" >&2
    exit 1
  fi

  {
    printf '%s\n' '\pset tuples_only on' '\pset format unaligned'
    printf "%s\n" "SELECT format('SELECT %L || E''\\t'' || count(*)::text FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    printf '%s\n' '\gexec'
  } | docker exec -i "$postgres_container" psql -X -v ON_ERROR_STOP=1 -Atq \
    -U inbound -d "$database" | LC_ALL=C sort >"$package_dir/$row_counts"

  archive_sha=$(sha256sum "$package_dir/$archive" | awk '{print $1}')
  archive_bytes=$(wc -c <"$package_dir/$archive" | tr -d ' ')
  row_counts_sha=$(sha256sum "$package_dir/$row_counts" | awk '{print $1}')
  database_json=$(jq -cn \
    --arg name "$database" \
    --arg archive "$archive" \
    --arg archiveSha256 "$archive_sha" \
    --arg rowCounts "$row_counts" \
    --arg rowCountsSha256 "$row_counts_sha" \
    --argjson archiveBytes "$archive_bytes" \
    '{name:$name,archive:$archive,archiveBytes:$archiveBytes,archiveSha256:$archiveSha256,rowCounts:$rowCounts,rowCountsSha256:$rowCountsSha256}')
  databases_json=$(jq -cn --argjson current "$databases_json" --argjson item "$database_json" '$current + [$item]')
done

jq -n \
  --arg packageId "$package_id" \
  --arg createdAt "$created_at" \
  --arg gitSha "$APP_GIT_SHA" \
  --arg imageDigest "$image_digest" \
  --arg evalModel "$eval_model" \
  --arg evalPromptHash "$eval_prompt_hash" \
  --argjson databases "$databases_json" \
  '{version:1,packageId:$packageId,createdAt:$createdAt,source:{gitSha:$gitSha,imageDigest:$imageDigest,evalModel:$evalModel,evalPromptHash:$evalPromptHash},databases:$databases}' \
  >"$package_dir/manifest.json"

if command -v node >/dev/null 2>&1 && [[ -f "${VERIFY_SCRIPT:-$(dirname "$0")/verify-golden-state.mjs}" ]]; then
  node "${VERIFY_SCRIPT:-$(dirname "$0")/verify-golden-state.mjs}" "$package_dir" >/dev/null
fi

if [[ "${BACKUP_LOCAL_ONLY:-0}" != 1 ]]; then
  bucket=${BACKUP_BUCKET:?BACKUP_BUCKET is required}
  for file in "$package_dir"/*; do
    aws s3 cp "$file" "s3://$bucket/$S3_PREFIX/packages/$package_id/$(basename "$file")" \
      --region "$AWS_REGION" --sse AES256 --only-show-errors
  done
  aws s3 cp "$package_dir/manifest.json" "s3://$bucket/$S3_PREFIX/latest.json" \
    --region "$AWS_REGION" --sse AES256 --only-show-errors
  rm -rf -- "$package_dir"
fi

backup_complete=1
printf 'golden-state backup complete: %s\n' "$package_id"

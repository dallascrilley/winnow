#!/usr/bin/env bash
set -euo pipefail

EXPECTED_DATABASES=$'inbound_analytics\ninbound_dispatch\ninbound_forms\ninbound_qualify\ninbound_scheduler'
AWS_REGION=${AWS_REGION:-us-east-1}
S3_PREFIX=${BACKUP_PREFIX:-golden-state}

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

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/inbound-golden-restore.XXXXXX")
trap 'rm -rf -- "$work_dir"' EXIT
umask 077

if [[ -n "${RESTORE_PACKAGE_DIR:-}" ]]; then
  cp -R "${RESTORE_PACKAGE_DIR}/." "$work_dir/"
else
  bucket=${BACKUP_BUCKET:?BACKUP_BUCKET or RESTORE_PACKAGE_DIR is required}
  aws s3 cp "s3://$bucket/$S3_PREFIX/latest.json" "$work_dir/manifest.json" \
    --region "$AWS_REGION" --only-show-errors
  package_id=$(jq -er '.packageId' "$work_dir/manifest.json")
  if [[ ! "$package_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]]; then
    echo "invalid golden-state package id" >&2
    exit 1
  fi
  while IFS= read -r filename; do
    if [[ ! "$filename" =~ ^[a-z0-9_.-]+$ ]]; then
      echo "unsafe golden-state filename" >&2
      exit 1
    fi
    aws s3 cp "s3://$bucket/$S3_PREFIX/packages/$package_id/$filename" "$work_dir/$filename" \
      --region "$AWS_REGION" --only-show-errors
  done < <(jq -r '.databases[] | .archive, .rowCounts' "$work_dir/manifest.json")
fi

[[ -f "$work_dir/manifest.json" && ! -L "$work_dir/manifest.json" ]] || { echo "unsafe golden-state manifest" >&2; exit 1; }
jq -e '.version == 1 and (.databases | length == 5)' "$work_dir/manifest.json" >/dev/null
actual_databases=$(jq -r '.databases[].name' "$work_dir/manifest.json" | LC_ALL=C sort)
if [[ "$actual_databases" != "$EXPECTED_DATABASES" ]]; then
  echo "golden-state database allowlist mismatch" >&2
  exit 1
fi

postgres_container=$(resolve_postgres_container)
if [[ ! "$postgres_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$ ]]; then
  echo "PostgreSQL container is unavailable" >&2
  exit 1
fi

while IFS=$'\t' read -r database archive archive_bytes archive_sha row_counts row_counts_sha; do
  if [[ ! "$archive" =~ ^[a-z0-9_.-]+$ ]] || [[ ! "$row_counts" =~ ^[a-z0-9_.-]+$ ]]; then
    echo "unsafe golden-state filename" >&2
    exit 1
  fi
  [[ -f "$work_dir/$archive" && ! -L "$work_dir/$archive" ]] || { echo "missing or unsafe golden-state archive" >&2; exit 1; }
  [[ -f "$work_dir/$row_counts" && ! -L "$work_dir/$row_counts" ]] || { echo "missing or unsafe golden-state row counts" >&2; exit 1; }
  [[ $(wc -c <"$work_dir/$archive" | tr -d ' ') == "$archive_bytes" ]] || { echo "golden-state archive size mismatch" >&2; exit 1; }
  [[ $(sha256sum "$work_dir/$archive" | awk '{print $1}') == "$archive_sha" ]] || { echo "golden-state archive checksum mismatch" >&2; exit 1; }
  [[ $(sha256sum "$work_dir/$row_counts" | awk '{print $1}') == "$row_counts_sha" ]] || { echo "golden-state row-count checksum mismatch" >&2; exit 1; }
  docker exec -i "$postgres_container" pg_restore --list <"$work_dir/$archive" >/dev/null
done < <(jq -r '.databases[] | [.name,.archive,(.archiveBytes|tostring),.archiveSha256,.rowCounts,.rowCountsSha256] | @tsv' "$work_dir/manifest.json")

if command -v node >/dev/null 2>&1 && [[ -f "${VERIFY_SCRIPT:-$(dirname "$0")/verify-golden-state.mjs}" ]]; then
  node "${VERIFY_SCRIPT:-$(dirname "$0")/verify-golden-state.mjs}" "$work_dir" >/dev/null
fi

if [[ "${RESTORE_CONFIRM:-}" != "replace-synthetic-databases" ]]; then
  echo "set RESTORE_CONFIRM=replace-synthetic-databases only for an approved fresh recovery target" >&2
  exit 1
fi

while IFS=$'\t' read -r database archive _archive_bytes _archive_sha row_counts row_counts_sha; do
  docker exec "$postgres_container" dropdb -U inbound --if-exists --force "$database"
  docker exec "$postgres_container" createdb -U inbound "$database"
  docker exec -i "$postgres_container" pg_restore -U inbound --exit-on-error \
    --no-owner --no-privileges -d "$database" <"$work_dir/$archive"

  restored_counts="$work_dir/$database.restored.rows.tsv"
  {
    printf '%s\n' '\pset tuples_only on' '\pset format unaligned'
    printf "%s\n" "SELECT format('SELECT %L || E''\\t'' || count(*)::text FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    printf '%s\n' '\gexec'
  } | docker exec -i "$postgres_container" psql -X -v ON_ERROR_STOP=1 -Atq \
    -U inbound -d "$database" | LC_ALL=C sort >"$restored_counts"
  [[ $(sha256sum "$restored_counts" | awk '{print $1}') == "$row_counts_sha" ]] || { echo "restored row-count checksum mismatch for $database" >&2; exit 1; }
done < <(jq -r '.databases[] | [.name,.archive,(.archiveBytes|tostring),.archiveSha256,.rowCounts,.rowCountsSha256] | @tsv' "$work_dir/manifest.json")

printf 'golden-state restore verified: %s\n' "$(jq -r '.packageId' "$work_dir/manifest.json")"

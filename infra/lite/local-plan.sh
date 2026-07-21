#!/usr/bin/env bash
# Build a no-apply local plan in a disposable copy before the S3 backend exists.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$ROOT/../.." && pwd)
OUTPUT_JSON=${1:-/tmp/inbound-lite-plan.json}
TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/inbound-lite-plan.XXXXXX")
PLAN_ROOT="${TEMP_ROOT}/repo/infra/lite"

cleanup() {
  rm -rf -- "${TEMP_ROOT}"
}
trap cleanup EXIT

umask 077
mkdir -p "${PLAN_ROOT}" "${TEMP_ROOT}/repo/scripts"
rsync -a \
  --exclude='.terraform/' \
  --exclude='*.tfplan' \
  --exclude='backend.hcl' \
  --exclude='backend.tf' \
  --exclude='state-bootstrap/' \
  "${ROOT}/" "${PLAN_ROOT}/"
rsync -a \
  "${REPO_ROOT}/scripts/backup-golden-state.sh" \
  "${REPO_ROOT}/scripts/restore-golden-state.sh" \
  "${REPO_ROOT}/scripts/verify-golden-state.mjs" \
  "${TEMP_ROOT}/repo/scripts/"

terraform -chdir="${PLAN_ROOT}" init -input=false
terraform -chdir="${PLAN_ROOT}" validate
terraform -chdir="${PLAN_ROOT}" plan -input=false -out=lite.tfplan
terraform -chdir="${PLAN_ROOT}" show -json lite.tfplan >"${OUTPUT_JSON}"
chmod 600 "${OUTPUT_JSON}"

echo "wrote local no-apply plan JSON to ${OUTPUT_JSON}"

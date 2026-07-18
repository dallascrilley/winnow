#!/usr/bin/env bash
# Render the ignored partial S3 backend config after state-bootstrap is applied.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
BOOTSTRAP_ROOT="${ROOT}/state-bootstrap"
BACKEND_CONFIG="${ROOT}/backend.hcl"

bucket=$(terraform -chdir="${BOOTSTRAP_ROOT}" output -raw bucket_name)
account_id=$(terraform -chdir="${BOOTSTRAP_ROOT}" output -raw aws_account_id)
region=$(terraform -chdir="${BOOTSTRAP_ROOT}" output -raw aws_region)

if [[ ! "${bucket}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "state bootstrap returned an invalid bucket name" >&2
  exit 1
fi
if [[ ! "${account_id}" =~ ^[0-9]{12}$ ]]; then
  echo "state bootstrap returned an invalid AWS account id" >&2
  exit 1
fi
if [[ ! "${region}" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]$ ]]; then
  echo "state bootstrap returned an invalid AWS region" >&2
  exit 1
fi

umask 077
{
  printf 'bucket              = "%s"\n' "${bucket}"
  printf 'region              = "%s"\n' "${region}"
  printf 'allowed_account_ids = ["%s"]\n' "${account_id}"
} >"${BACKEND_CONFIG}"
chmod 600 "${BACKEND_CONFIG}"

echo "wrote ${BACKEND_CONFIG} (ignored, mode 0600)"

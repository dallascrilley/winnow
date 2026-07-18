#!/usr/bin/env bash
# Build the shared ARM64 app image, then publish only its immutable content ref.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REGION="${AWS_REGION:-us-east-1}"
TAG="${1:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"

repository_uri=$(terraform -chdir="$ROOT/infra/lite" output -raw app_repository_url)
image_ref=$("$ROOT/scripts/push-app-image.sh" "$repository_uri" "$TAG")
git_sha=$(git -C "$ROOT" rev-parse HEAD)

if [[ ! "$image_ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "image build did not return an immutable digest" >&2
  exit 1
fi

aws ssm put-parameter \
  --name /inbound-lite/APP_IMAGE_REF \
  --type String \
  --value "$image_ref" \
  --overwrite \
  --region "$REGION" >/dev/null

aws ssm put-parameter \
  --name /inbound-lite/APP_GIT_SHA \
  --type String \
  --value "$git_sha" \
  --overwrite \
  --region "$REGION" >/dev/null

printf '%s\n' "$image_ref"

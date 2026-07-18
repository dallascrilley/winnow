#!/usr/bin/env bash
# Runs on the EC2 host through systemd. Secret values never enter argv or Compose.
set -euo pipefail

ROOT=/opt/inbound-lite
SECRETS_DIR=/run/inbound-lite/secrets
PARAMETER_PREFIX=/inbound-lite
RUNTIME_ENV=/run/inbound-lite/runtime.env

imds_token=$(curl -fsS --retry 3 -X PUT \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
  http://169.254.169.254/latest/api/token)
region=$(curl -fsS --retry 3 \
  -H "X-aws-ec2-metadata-token: $imds_token" \
  http://169.254.169.254/latest/meta-data/placement/region)
unset imds_token

if [[ ! "$region" =~ ^[a-z]{2}-[a-z]+-[0-9]$ ]]; then
  echo "unable to resolve AWS region" >&2
  exit 1
fi

account_id=$(aws sts get-caller-identity --region "$region" --query Account --output text)
if [[ ! "$account_id" =~ ^[0-9]{12}$ ]]; then
  echo "unable to resolve AWS account" >&2
  exit 1
fi

install -d -m 0700 "$SECRETS_DIR"
umask 077

read_parameter_to_file() {
  local name="$1"
  local output="$SECRETS_DIR/$name"
  aws ssm get-parameter \
    --name "$PARAMETER_PREFIX/$name" \
    --with-decryption \
    --region "$region" \
    --query Parameter.Value \
    --output text > "$output"
  if [[ ! -s "$output" || "$(<"$output")" == "None" ]]; then
    echo "required runtime parameter is unavailable: $name" >&2
    exit 1
  fi
  chmod 0400 "$output"
}

for parameter_name in \
  DATABASE_PASSWORD \
  BETTER_AUTH_SECRET \
  A2A_SECRET \
  ANALYTICS_PUBLIC_KEY \
  OPENAI_API_KEY
do
  read_parameter_to_file "$parameter_name"
done

app_image_ref=$(aws ssm get-parameter \
  --name "$PARAMETER_PREFIX/APP_IMAGE_REF" \
  --region "$region" \
  --query Parameter.Value \
  --output text)
if [[ ! "$app_image_ref" =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
  echo "immutable app image is not deployed" >&2
  exit 1
fi

app_git_sha=$(aws ssm get-parameter \
  --name "$PARAMETER_PREFIX/APP_GIT_SHA" \
  --region "$region" \
  --query Parameter.Value \
  --output text)
if [[ ! "$app_git_sha" =~ ^[0-9a-f]{40}$ ]] || [[ "$app_git_sha" == "0000000000000000000000000000000000000000" ]]; then
  echo "app source identity is not deployed" >&2
  exit 1
fi

registry="$account_id.dkr.ecr.$region.amazonaws.com"
aws ecr get-login-password --region "$region" \
  | docker login --username AWS --password-stdin "$registry" >/dev/null

export APP_IMAGE_REF="$app_image_ref"
export APP_GIT_SHA="$app_git_sha"
export AWS_REGION="$region"
export ORIGIN_ADDRESS="${INBOUND_LITE_ORIGIN_ADDRESS:?INBOUND_LITE_ORIGIN_ADDRESS is required}"
export PUBLIC_URL="${INBOUND_LITE_PUBLIC_URL:?INBOUND_LITE_PUBLIC_URL is required}"

if [[ ! "$ORIGIN_ADDRESS" =~ ^[a-z0-9][a-z0-9.-]{0,252}$ ]]; then
  echo "invalid origin address" >&2
  exit 1
fi
if [[ ! "$PUBLIC_URL" =~ ^https://[a-z0-9][a-z0-9.-]{0,252}$ ]]; then
  echo "invalid public URL" >&2
  exit 1
fi

{
  printf 'APP_IMAGE_REF=%s\n' "$APP_IMAGE_REF"
  printf 'APP_GIT_SHA=%s\n' "$APP_GIT_SHA"
  printf 'AWS_REGION=%s\n' "$AWS_REGION"
  printf 'ORIGIN_ADDRESS=%s\n' "$ORIGIN_ADDRESS"
  printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
} > "$RUNTIME_ENV"
chmod 0600 "$RUNTIME_ENV"

compose=(docker compose --env-file "$RUNTIME_ENV" --project-directory "$ROOT" -f "$ROOT/compose.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" up -d --remove-orphans --wait

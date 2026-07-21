#!/usr/bin/env bash
# Build the shared ARM64 application image once and print its immutable ECR ref.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
REGION="${AWS_REGION:-us-east-1}"
REPOSITORY_URI="${1:?usage: scripts/push-app-image.sh <ecr-repository-uri> [tag]}"
TAG="${2:-latest}"

if [[ ! "$REPOSITORY_URI" =~ ^[0-9]+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9._/-]+$ ]]; then
  echo "invalid ECR repository URI" >&2
  exit 2
fi
if [[ ! "$TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  echo "invalid image tag" >&2
  exit 2
fi

REGISTRY="${REPOSITORY_URI%%/*}"
REPOSITORY_NAME="${REPOSITORY_URI#*/}"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY" >&2

docker buildx build \
  --platform linux/arm64 \
  --push \
  -t "$REPOSITORY_URI:$TAG" \
  "$ROOT" >&2

DIGEST=$(aws ecr describe-images \
  --repository-name "$REPOSITORY_NAME" \
  --image-ids "imageTag=$TAG" \
  --region "$REGION" \
  --query 'imageDetails[0].imageDigest' \
  --output text)

if [[ ! "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "ECR did not return a content digest" >&2
  exit 1
fi

printf '%s@%s\n' "$REPOSITORY_URI" "$DIGEST"

#!/usr/bin/env bash
# Build and push the app + ollama images to ECR (run from the repo root after
# `terraform apply` created the repos; re-run on every app change).
set -euo pipefail
unset CDPATH
cd -- "$(dirname -- "$0")/.."

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
APP_REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/inbound-demo"
OLLAMA_REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/inbound-demo-ollama"

# App image (workspace, all five apps). The shared helper pushes directly from
# buildx and returns the immutable content reference used by both profiles.
APP_IMAGE_REF=$(./scripts/push-app-image.sh "$APP_REPO")

# Ollama sidecar with the scorer model baked in — first boot must not spend
# five minutes pulling 2.5 GB through the task's ephemeral disk.
docker buildx build --platform linux/arm64 --push -t "$OLLAMA_REPO:latest" -f - . <<'DOCKERFILE'
FROM ollama/ollama:latest
RUN ollama serve & \
    for i in $(seq 1 30); do curl -sf localhost:11434/api/tags >/dev/null && break; sleep 1; done; \
    ollama pull qwen3:4b && \
    ollama list | grep -q "^qwen3:4b" && \
    { pkill -f "ollama serve" || true; }
DOCKERFILE

OLLAMA_DIGEST=$(aws ecr describe-images \
  --repository-name inbound-demo-ollama \
  --image-ids imageTag=latest \
  --region "$REGION" \
  --query 'imageDetails[0].imageDigest' \
  --output text)
if [[ ! "$OLLAMA_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "ECR did not return the Ollama content digest" >&2
  exit 1
fi
OLLAMA_IMAGE_REF="$OLLAMA_REPO@$OLLAMA_DIGEST"

# Terraform auto-loads this generated, gitignored file on the second apply.
# It contains image identities only, never credentials.
node -e 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], `${JSON.stringify({ app_image_ref: process.argv[2], ollama_image_ref: process.argv[3] }, null, 2)}\n`);' \
  infra/image-refs.auto.tfvars.json "$APP_IMAGE_REF" "$OLLAMA_IMAGE_REF"

echo "pushed immutable images:"
echo "  app:    $APP_IMAGE_REF"
echo "  ollama: $OLLAMA_IMAGE_REF"
echo "apply the generated refs with:"
echo "  terraform -chdir=infra apply"

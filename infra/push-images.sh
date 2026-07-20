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

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

# App image (workspace, all five apps). --load: OrbStack buildkit keeps plain
# builds in the build cache where `docker push` can't see them.
docker buildx build --platform linux/arm64 --load -t "$APP_REPO:latest" -t inbound-demo:latest .
docker push "$APP_REPO:latest"

# Ollama sidecar with the scorer model baked in — first boot must not spend
# five minutes pulling 2.5 GB through the task's ephemeral disk.
docker buildx build --platform linux/arm64 --load -t "$OLLAMA_REPO:latest" -f - . <<'DOCKERFILE'
FROM ollama/ollama:latest
RUN ollama serve & \
    for i in $(seq 1 30); do curl -sf localhost:11434/api/tags >/dev/null && break; sleep 1; done; \
    ollama pull qwen3:4b && \
    ollama list | grep -q "^qwen3:4b" && \
    { pkill -f "ollama serve" || true; }
DOCKERFILE
docker push "$OLLAMA_REPO:latest"

echo "pushed. Force a fresh rollout with:"
echo "  aws ecs update-service --cluster inbound-demo --service inbound-demo --force-new-deployment --region $REGION"

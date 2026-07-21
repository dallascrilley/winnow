#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE=""
KEEP_FOR_INTERVIEW=0
REGION=${AWS_REGION:-us-east-1}
RECEIPT="$ROOT/docs/receipts/aws-standard/latest.json"
RUN_ROOT=""
STACK_CREATED=0
PROOF_SUCCEEDED=0
TEARDOWN_COMPLETE=0

usage() {
  cat <<'EOF'
usage: infra/proof-standard.sh --dry-run [--keep-for-interview]
       infra/proof-standard.sh --execute [--keep-for-interview]

--dry-run             print the exact bounded workflow without AWS mutation
--execute             run it; requires PROOF_CONFIRM=apply-standard-and-destroy
--keep-for-interview  retain only a successful proof for at most 24 hours;
                      requires KEEP_STANDARD_CONFIRM=retain-standard-for-at-most-24-hours
EOF
}

while (($#)); do
  case "$1" in
    --dry-run | --execute)
      if [[ -n "$MODE" ]]; then
        echo "choose exactly one mode" >&2
        exit 2
      fi
      MODE=${1#--}
      ;;
    --keep-for-interview) KEEP_FOR_INTERVIEW=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ -z "$MODE" ]]; then
  echo "choose --dry-run or --execute" >&2
  exit 2
fi
if [[ $KEEP_FOR_INTERVIEW == 1 ]] &&
  [[ ${KEEP_STANDARD_CONFIRM:-} != "retain-standard-for-at-most-24-hours" ]]; then
  echo "--keep-for-interview requires KEEP_STANDARD_CONFIRM=retain-standard-for-at-most-24-hours" >&2
  exit 2
fi
if [[ "$MODE" == "execute" ]] &&
  [[ ${PROOF_CONFIRM:-} != "apply-standard-and-destroy" ]]; then
  echo "--execute requires PROOF_CONFIRM=apply-standard-and-destroy" >&2
  exit 2
fi

if [[ "$MODE" == "execute" || ${PROOF_ALLOW_DIRTY_FOR_TESTS:-0} != 1 ]] &&
  [[ -n $(git -C "$ROOT" status --porcelain --untracked-files=all) ]]; then
  echo "standard proof requires a clean worktree" >&2
  exit 1
fi

retention_deadline() {
  node -e 'console.log(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())'
}

print_plan() {
  cat <<'EOF'
1. validate clean Git ownership and standard Terraform
2. bootstrap standard repositories with ECS scaled to zero
3. push immutable app and Ollama images
4. deploy immutable refs and wait for stable ECS service
5. run production seed and fresh offline eval
6. run planted-lead smoke
7. verify Terraform drift and the five-dollar/24-hour bounds
8. terraform destroy and verify zero standard residual resources
9. write verified sanitized receipt
EOF
  if [[ $KEEP_FOR_INTERVIEW == 1 ]]; then
    echo "retention deadline: $(retention_deadline)"
    echo "cleanup command: terraform -chdir=infra destroy -auto-approve -input=false"
    echo "latest.json is not updated until teardown is verified"
  fi
}

if [[ "$MODE" == "dry-run" ]]; then
  print_plan
  exit 0
fi

RUN_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/inbound-standard-proof.XXXXXX")
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
STARTED_SECONDS=$(date +%s)
GIT_SHA=$(git -C "$ROOT" rev-parse HEAD)
LITE_FINGERPRINT=""

capture_lite_fingerprint() {
  aws resourcegroupstaggingapi get-resources \
    --region "$REGION" \
    --tag-filters Key=project,Values=inbound-lite,inbound-lite-state \
    --query 'ResourceTagMappingList[].ResourceARN' \
    --output text | tr '\t' '\n' | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
}

verify_zero_inventory() {
  local output=$1
  local terraform_count ecs_count rds_count snapshot_count alb_count acm_count
  local ecr_count log_count ssm_count
  terraform_count=$(terraform -chdir="$ROOT/infra" state list | sed '/^$/d' | wc -l | tr -d ' ')
  ecs_count=$(aws ecs describe-clusters --region "$REGION" --clusters inbound-demo \
    --query "length(clusters[?status==\`ACTIVE\`])" --output text)
  rds_count=$(aws rds describe-db-instances --region "$REGION" \
    --query "length(DBInstances[?DBInstanceIdentifier=='inbound-demo'])" --output text)
  snapshot_count=$(aws rds describe-db-snapshots --region "$REGION" \
    --query "length(DBSnapshots[?DBInstanceIdentifier=='inbound-demo'])" --output text)
  alb_count=$(aws elbv2 describe-load-balancers --region "$REGION" \
    --query "length(LoadBalancers[?LoadBalancerName=='inbound-demo'])" --output text)
  acm_count=$(aws acm list-certificates --region "$REGION" \
    --query "length(CertificateSummaryList[?DomainName=='inbound-standard-origin.dallascrilley.com'])" --output text)
  ecr_count=$(aws ecr describe-repositories --region "$REGION" \
    --query "length(repositories[?repositoryName=='inbound-demo' || repositoryName=='inbound-demo-ollama'])" --output text)
  log_count=$(aws logs describe-log-groups --region "$REGION" \
    --log-group-name-prefix /ecs/inbound-demo \
    --query "length(logGroups[?logGroupName=='/ecs/inbound-demo'])" --output text)
  ssm_count=$(aws ssm get-parameters-by-path --region "$REGION" \
    --path /inbound-demo --recursive --query 'length(Parameters)' --output text)
  node -e 'const fs=require("node:fs"); const values=process.argv.slice(2).map(Number); const keys=["terraformResources","ecsClusters","rdsInstances","rdsSnapshots","loadBalancers","acmCertificates","ecrRepositories","logGroups","ssmParameters"]; const result=Object.fromEntries(keys.map((key,index)=>[key,values[index]])); if(values.some(value=>value!==0)) process.exitCode=1; fs.writeFileSync(process.argv[1], JSON.stringify(result));' \
    "$output" "$terraform_count" "$ecs_count" "$rds_count" "$snapshot_count" \
    "$alb_count" "$acm_count" "$ecr_count" "$log_count" "$ssm_count"
}

destroy_standard() {
  terraform -chdir="$ROOT/infra" destroy -auto-approve -input=false
  verify_zero_inventory "$RUN_ROOT/residual.json"
  local after
  after=$(capture_lite_fingerprint)
  [[ "$after" == "$LITE_FINGERPRINT" ]] || {
    echo "lite resource fingerprint changed during standard proof" >&2
    return 1
  }
  TEARDOWN_COMPLETE=1
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ $STACK_CREATED == 1 && $TEARDOWN_COMPLETE == 0 ]]; then
    if [[ $PROOF_SUCCEEDED == 0 || $KEEP_FOR_INTERVIEW == 0 ]]; then
      echo "standard proof cleanup: destroying standard resources" >&2
      set +e
      destroy_standard
      local cleanup_status=$?
      set -e
      if [[ $cleanup_status != 0 ]]; then
        echo "CRITICAL: automatic standard teardown failed; run terraform -chdir=infra destroy immediately" >&2
        status=1
      fi
    fi
  fi
  rm -rf -- "$RUN_ROOT"
  exit "$status"
}
trap cleanup EXIT INT TERM

for command in aws docker jq node terraform; do
  command -v "$command" >/dev/null || {
    echo "required proof command is unavailable: $command" >&2
    exit 1
  }
done
LITE_FINGERPRINT=$(capture_lite_fingerprint)
terraform -chdir="$ROOT/infra" init -input=false
terraform -chdir="$ROOT/infra" fmt -check
terraform -chdir="$ROOT/infra" validate
STACK_CREATED=1
terraform -chdir="$ROOT/infra" apply -auto-approve -input=false -var=bootstrap_images=true
"$ROOT/infra/push-images.sh"
terraform -chdir="$ROOT/infra" apply -auto-approve -input=false -var=bootstrap_images=false

CLUSTER=$(terraform -chdir="$ROOT/infra" output -raw ecs_cluster)
SERVICE=$(terraform -chdir="$ROOT/infra" output -raw ecs_service)
ALB_DNS=$(terraform -chdir="$ROOT/infra" output -raw alb_dns_name)
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$SERVICE" \
  --force-new-deployment >/dev/null
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE"

SERVICE_JSON=$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json)
TASK_DEFINITION=$(jq -er '.services[0].taskDefinition' <<<"$SERVICE_JSON")
NETWORK_CONFIGURATION=$(jq -c '.services[0].networkConfiguration' <<<"$SERVICE_JSON")
OLLAMA_DIGEST=$(jq -er '.ollama_image_ref | capture("@(?<digest>sha256:[0-9a-f]{64})$").digest' \
  "$ROOT/infra/image-refs.auto.tfvars.json")
OVERRIDES=$(jq -cn \
  --arg track "http://$ALB_DNS/inbound/analytics/track" \
  --arg digest "$OLLAMA_DIGEST" \
  '{containerOverrides:[{name:"app",command:["pnpm","exec","tsx","scripts/prod-proof.mjs"],environment:[{name:"SEED_TRACK_URL",value:$track},{name:"OLLAMA_IMAGE_DIGEST",value:$digest}]}]}')
TASK_ARN=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$TASK_DEFINITION" --network-configuration "$NETWORK_CONFIGURATION" \
  --overrides "$OVERRIDES" --query 'tasks[0].taskArn' --output text)
[[ "$TASK_ARN" == arn:aws:ecs:*:task/* ]] || {
  echo "standard seed/eval task did not start" >&2
  exit 1
}
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
TASK_ID=${TASK_ARN##*/}
# JMESPath string literals use backticks and must remain single-quoted.
# shellcheck disable=SC2016
APP_EXIT=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[?name==`app`].exitCode | [0]' --output text)
[[ "$APP_EXIT" == 0 ]] || {
  echo "standard seed/eval task failed with app exit $APP_EXIT" >&2
  exit 1
}

EVAL_BASE64=""
for _ in {1..30}; do
  EVAL_BASE64=$(aws logs get-log-events --region "$REGION" --log-group-name /ecs/inbound-demo \
    --log-stream-name "app/app/$TASK_ID" --start-from-head \
    --query 'events[].message' --output text 2>/dev/null |
    tr '\t' '\n' | sed -n 's/^STANDARD_PROOF_EVAL_BASE64=//p' | tail -1)
  [[ -n "$EVAL_BASE64" ]] && break
  sleep 2
done
[[ -n "$EVAL_BASE64" ]] || {
  echo "fresh eval marker was not found in the seed task logs" >&2
  exit 1
}
node -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], Buffer.from(process.argv[2], "base64url"));' \
  "$RUN_ROOT/eval.json" "$EVAL_BASE64"

"$ROOT/scripts/smoke.sh" "http://$ALB_DNS/inbound"
set +e
terraform -chdir="$ROOT/infra" plan -detailed-exitcode -input=false >/dev/null
PLAN_STATUS=$?
set -e
[[ $PLAN_STATUS == 0 ]] || {
  echo "standard Terraform drift detected after proof" >&2
  exit 1
}
PROOF_SUCCEEDED=1

if [[ $KEEP_FOR_INTERVIEW == 1 ]]; then
  echo "retention deadline: $(retention_deadline)"
  echo "cleanup command: terraform -chdir=infra destroy -auto-approve -input=false"
  echo "latest.json is not updated until teardown is verified"
  exit 0
fi

destroy_standard
FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
FINISHED_SECONDS=$(date +%s)
TERRAFORM_VERSION=$(terraform version -json | jq -er '.terraform_version')
APP_IMAGE_REF=$(jq -er '.app_image_ref' "$ROOT/infra/image-refs.auto.tfvars.json")
OLLAMA_IMAGE_REF=$(jq -er '.ollama_image_ref' "$ROOT/infra/image-refs.auto.tfvars.json")
TASK_REVISION=${TASK_DEFINITION##*:}
ESTIMATED_COST=$(node -e 'const hours=(Number(process.argv[2])-Number(process.argv[1]))/3600; console.log(Math.max(0,hours*0.20).toFixed(2));' "$STARTED_SECONDS" "$FINISHED_SECONDS")
node -e 'const fs=require("node:fs"); const [out,gitSha,startedAt,finishedAt,region,terraformVersion,appImageRef,ollamaImageRef,taskDefinitionRevision,evalPath,cost,residualPath]=process.argv.slice(1); fs.writeFileSync(out, JSON.stringify({version:1,gitSha,startedAt,finishedAt,region,terraformVersion,appImageRef,ollamaImageRef,taskDefinitionRevision:Number(taskDefinitionRevision),smoke:{passed:true,terminalStatus:"routed"},eval:JSON.parse(fs.readFileSync(evalPath,"utf8")),estimatedCostUsd:Number(cost),teardownStatus:"verified",residualInventory:JSON.parse(fs.readFileSync(residualPath,"utf8"))}));' \
  "$RUN_ROOT/receipt-input.json" "$GIT_SHA" "$STARTED_AT" "$FINISHED_AT" "$REGION" \
  "$TERRAFORM_VERSION" "$APP_IMAGE_REF" "$OLLAMA_IMAGE_REF" "$TASK_REVISION" \
  "$RUN_ROOT/eval.json" "$ESTIMATED_COST" "$RUN_ROOT/residual.json"
node "$ROOT/scripts/capture-standard-receipt.mjs" "$RUN_ROOT/receipt-input.json" "$RECEIPT"
trap - EXIT INT TERM
rm -rf -- "$RUN_ROOT"
echo "standard proof complete; teardown verified"

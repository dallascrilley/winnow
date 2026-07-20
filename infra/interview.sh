#!/usr/bin/env bash
# Interview mode — on-demand bring-up/verify/teardown for the Inbound demo
# stack (ECS Fargate app+ollama sidecar, RDS PG16, ALB, ECR, SSM). One
# session = one `up`, then `down` before you walk away. See
# docs/interview-mode.md for the full runbook, prerequisites, and timings.
#
#   infra/interview.sh up       # apply, push images, roll out, seed, smoke
#   infra/interview.sh status   # read-only: outputs + ECS state + healthz
#   infra/interview.sh down     # destroy (asks for typed confirmation)
#
# Every AWS identifier (ALB DNS name, subnets, security group, cluster,
# service, image repos) is read from `terraform output` or an `aws` query at
# run time. Nothing here is hardcoded — the ALB DNS name, subnet ids, and SG
# id all change on every destroy + re-apply cycle.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
HEALTHZ_TIMEOUT_S="${HEALTHZ_TIMEOUT_S:-900}"   # 15 min — cold boot is migrations + ollama model load
SEED_TIMEOUT_S="${SEED_TIMEOUT_S:-600}"          # 10 min
POLL_INTERVAL_S=15

say()  { printf '%s\n' "$*"; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!!\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31mERROR\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<'EOF'
Usage: infra/interview.sh <up|down|status> [--yes]

  up      Bring the full stack up: terraform apply, build+push images,
          force a fresh ECS deployment, wait for /healthz, run the prod
          seed task, run the smoke test, print a dated receipt block.
  down    Tear the full stack down: terraform destroy (typed confirmation
          required unless --yes), print a teardown receipt.
  status  Read-only: terraform outputs, ECS service state, one healthz probe.

  --yes   Skip interactive confirmation (for scripted/CI use). Never
          bypasses the cost banner on `up`.
EOF
}

cost_banner() {
  cat <<'EOF'

================================================================================
  COST WARNING — this brings up billable AWS infrastructure.
    Fargate (2 vCPU / 8 GB) + RDS db.t4g.micro + ALB ~= $0.25-0.30/hr
    Left running continuously: ~$122-125/mo
  This is "interview mode": bring it up for a session, then tear it down.
  Run `infra/interview.sh down` the moment you are done — do not leave it up.
================================================================================

EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

confirm() {
  # confirm <prompt> <required-typed-word>
  local prompt="$1" word="$2"
  if [ "$ASSUME_YES" = "1" ]; then
    info "skipping confirmation (--yes): $prompt"
    return 0
  fi
  read -r -p "$prompt Type '$word' to continue: " reply
  [ "$reply" = "$word" ] || die "confirmation did not match '$word' — aborting, nothing changed."
}

tf() {
  terraform -chdir="$SCRIPT_DIR" "$@"
}

tf_out() {
  # tf_out <output-name> — raw scalar output
  tf output -raw "$1" 2>/dev/null || die "terraform output '$1' not available — did 'terraform apply' run and succeed?"
}

tf_out_json() {
  tf output -json "$1" 2>/dev/null || die "terraform output '$1' not available — did 'terraform apply' run and succeed?"
}

require_tfvars() {
  [ -f "$SCRIPT_DIR/terraform.tfvars" ] || die "$SCRIPT_DIR/terraform.tfvars is missing (needs db_password at minimum) — see docs/interview-mode.md prerequisites."
}

# ---------------------------------------------------------------------------
# Cloudflare DNS automation (optional — token via 1Password)
# ---------------------------------------------------------------------------
# A zone-capable token lives in 1Password ("Cloudflare API Token -
# dallascrilley.com (dallasdotjs)"); referenced here by op:// path only. The
# value is read at run time, exported as TF_VAR_cloudflare_api_token for the
# terraform cloudflare provider, and never written to disk or printed. When
# op or the token is unavailable, everything falls back to the manual-DNS
# posture (HTTP on the raw ALB name; records printed for the operator).
CF_OP_REF="op://Private/xqtgoqisc3pvecxfiie7fxnnqy/credential"
DNS_ZONE="dallascrilley.com"        # keep in sync with var.cloudflare_zone_name
DNS_HOST="demos.dallascrilley.com"  # keep in sync with var.demo_hostname
DNS_BACKUP="$SCRIPT_DIR/.interview-dns-backup.json"
DNS_AUTO=0
CF_TOKEN=""
CF_ZONE_ID=""

cf_api() { # cf_api <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -m 20 -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -s -m 20 -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json"
  fi
}

dns_setup() {
  # Best effort: enables DNS automation when op + the token + the zone are all
  # reachable; otherwise leaves DNS_AUTO=0 and the manual posture applies.
  command -v op >/dev/null 2>&1 || { warn "1Password CLI (op) not found — DNS stays manual"; return 0; }
  CF_TOKEN=$(op read "$CF_OP_REF" 2>/dev/null || true)
  [ -n "$CF_TOKEN" ] || { warn "could not read Cloudflare token from 1Password ($CF_OP_REF) — DNS stays manual"; return 0; }
  CF_ZONE_ID=$(cf_api GET "/zones?name=${DNS_ZONE}" | python3 -c 'import sys,json
try:
    r = json.load(sys.stdin).get("result") or []
    print(r[0]["id"] if r else "")
except Exception:
    print("")')
  if [ -z "$CF_ZONE_ID" ]; then
    warn "Cloudflare token cannot see zone ${DNS_ZONE} — DNS stays manual"
    CF_TOKEN=""
    return 0
  fi
  export TF_VAR_cloudflare_api_token="$CF_TOKEN"
  DNS_AUTO=1
  info "DNS automation enabled: zone ${DNS_ZONE} (token from 1Password)"
}

dns_backup_and_clear_host() {
  # terraform creates the ${DNS_HOST} record with manage_dns=true; any
  # pre-existing foreign record on that name (e.g. the Cloudflare Pages CNAME
  # that parks there between sessions) would collide. Back it up so `down`
  # can restore it, then delete it — unless terraform already owns the name.
  if tf state list 2>/dev/null | grep -q '^cloudflare_record\.demo'; then
    return 0
  fi
  local records count
  records=$(cf_api GET "/zones/${CF_ZONE_ID}/dns_records?name=${DNS_HOST}")
  count=$(printf '%s' "$records" | python3 -c 'import sys,json
try:
    print(len(json.load(sys.stdin).get("result") or []))
except Exception:
    print(0)')
  [ "$count" -gt 0 ] || return 0
  if [ ! -f "$DNS_BACKUP" ]; then
    printf '%s' "$records" | python3 -c 'import sys,json
rs = json.load(sys.stdin)["result"]
json.dump([{k: r[k] for k in ("type","name","content","ttl","proxied")} for r in rs], sys.stdout)' > "$DNS_BACKUP"
    info "backed up existing ${DNS_HOST} record(s) to $DNS_BACKUP"
  fi
  printf '%s' "$records" | python3 -c 'import sys,json
for r in json.load(sys.stdin)["result"]:
    print(r["id"])' | while IFS= read -r rec_id; do
    [ -n "$rec_id" ] && cf_api DELETE "/zones/${CF_ZONE_ID}/dns_records/${rec_id}" >/dev/null
  done
  info "cleared pre-existing ${DNS_HOST} record(s) so terraform can own the name"
}

dns_restore_host() {
  [ -f "$DNS_BACKUP" ] || return 0
  if [ "$DNS_AUTO" != "1" ]; then
    warn "DNS backup exists at $DNS_BACKUP but DNS automation is unavailable — restore it by hand"
    return 0
  fi
  info "restoring pre-interview ${DNS_HOST} DNS record(s)"
  local restore_fail=0 line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if ! cf_api POST "/zones/${CF_ZONE_ID}/dns_records" "$line" \
        | python3 -c 'import sys,json
sys.exit(0 if json.load(sys.stdin).get("success") else 1)' 2>/dev/null; then
      restore_fail=1
    fi
  done < <(python3 -c 'import json,sys
for r in json.load(open(sys.argv[1])):
    print(json.dumps(r))' "$DNS_BACKUP")
  if [ "$restore_fail" = "0" ]; then
    rm -f "$DNS_BACKUP"
    info "DNS restore complete"
  else
    warn "some DNS records failed to restore — backup kept at $DNS_BACKUP"
  fi
}

# ---------------------------------------------------------------------------
# up
# ---------------------------------------------------------------------------

cmd_up() {
  cost_banner
  require_cmd terraform
  require_cmd aws
  require_cmd docker
  require_cmd python3
  require_cmd timeout   # GNU coreutils on macOS: brew install coreutils
  require_tfvars

  info "checking AWS credentials"
  aws sts get-caller-identity --region "$REGION" >/dev/null \
    || die "AWS credentials not available (aws sts get-caller-identity failed). Configure them and retry."

  dns_setup

  if [ "$ASSUME_YES" != "1" ]; then
    read -r -p "Continue bringing the stack up? [y/N] " reply
    case "$reply" in y|Y|yes|YES) ;; *) die "aborted — nothing changed." ;; esac
  fi

  info "terraform init (idempotent)"
  tf init -input=false

  # -input=false disables terraform's interactive approval prompt, which makes
  # a bare apply error out; the script's own confirmation above is the gate.
  if [ "$DNS_AUTO" = "1" ]; then
    dns_backup_and_clear_host
    info "terraform apply (phase 1: stack + DNS records; waits for ACM cert validation)"
    tf apply -input=false -auto-approve -var manage_dns=true
    info "terraform apply (phase 2: attach HTTPS listener + HTTP->HTTPS redirect)"
    tf apply -input=false -auto-approve -var manage_dns=true -var cert_validated=true
  else
    info "terraform apply (manual-DNS posture: HTTP on the raw ALB name)"
    tf apply -input=false -auto-approve
  fi

  local alb_dns cluster service public_prefix
  alb_dns=$(tf_out alb_dns_name)
  cluster=$(tf_out ecs_cluster)
  service=$(tf_out ecs_service)
  public_prefix=$(tf_out public_prefix)
  local base_url
  if [ "$DNS_AUTO" = "1" ]; then
    base_url="https://${DNS_HOST}${public_prefix}"
  else
    base_url="http://${alb_dns}${public_prefix}"
  fi

  info "ALB: $alb_dns  cluster: $cluster  service: $service"
  info "working URL for this session: $base_url"

  info "building + pushing images (infra/push-images.sh)"
  warn "this pkills any local 'ollama serve' — see docs/interview-mode.md"
  push_images_with_retry

  info "forcing a fresh ECS deployment"
  aws ecs update-service \
    --cluster "$cluster" --service "$service" \
    --force-new-deployment --region "$REGION" >/dev/null

  info "waiting for /healthz (timeout ${HEALTHZ_TIMEOUT_S}s — cold boot is migrations + ollama model load, typically 5-10 min)"
  wait_for_healthz "$base_url" "$HEALTHZ_TIMEOUT_S"

  info "running prod seed task"
  run_seed_task "$cluster" "$base_url"

  info "running smoke test"
  local smoke_log smoke_status
  smoke_log="$(mktemp "${TMPDIR:-/tmp}/inbound-smoke.XXXXXX.log")"
  if "$REPO_ROOT/scripts/smoke.sh" "$base_url" | tee "$smoke_log"; then
    smoke_status="SMOKE PASS"
  else
    smoke_status="SMOKE FAIL (see $smoke_log)"
  fi

  print_up_receipt "$base_url" "$smoke_status"

  warn "stack is UP and billing. Run 'infra/interview.sh down' when you are done."
}

push_images_with_retry() {
  # OrbStack buildkit occasionally drops the connection mid-export
  # ("exporting to image" EOF) — transient, retry a few times.
  local attempts=3 n=1
  while [ "$n" -le "$attempts" ]; do
    if AWS_REGION="$REGION" "$SCRIPT_DIR/push-images.sh"; then
      return 0
    fi
    warn "push-images.sh failed (attempt $n/$attempts) — buildkit EOF is usually transient, retrying"
    n=$((n + 1))
    sleep 5
  done
  die "push-images.sh failed after $attempts attempts"
}

wait_for_healthz() {
  local base_url="$1" timeout_s="$2"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout_s" ]; do
    local body ok
    body=$(curl -s -m 10 "$base_url/healthz" 2>/dev/null || true)
    ok=$(printf '%s' "$body" | python3 -c 'import sys,json
try:
    print(str(json.load(sys.stdin).get("ok")).lower())
except Exception:
    print("")' 2>/dev/null || true)
    if [ "$ok" = "true" ]; then
      say ""
      info "healthy after ${elapsed}s"
      return 0
    fi
    printf '.'
    sleep "$POLL_INTERVAL_S"
    elapsed=$((elapsed + POLL_INTERVAL_S))
  done
  say ""
  die "timed out after ${timeout_s}s waiting for $base_url/healthz — check CloudWatch log group /ecs/inbound-demo"
}

run_seed_task() {
  local cluster="$1" base_url="$2"
  # The task definition family is set to local.name in infra/ecs.tf, the
  # same string as the cluster and service names — no separate output needed.
  local family="$cluster"
  local subnets sg subnets_json
  subnets_json=$(tf_out_json task_subnets)
  subnets=$(printf '%s' "$subnets_json" | python3 -c 'import sys,json; print(",".join(json.load(sys.stdin)))')
  sg=$(tf_out tasks_security_group)

  local public_url seed_track_url
  public_url=$(tf_out public_url)
  seed_track_url="${base_url}/analytics/track"

  local network_config overrides task_arn
  network_config=$(printf '{"awsvpcConfiguration":{"subnets":[%s],"securityGroups":["%s"],"assignPublicIp":"ENABLED"}}' \
    "$(printf '%s' "$subnets" | sed 's/,/","/g; s/^/"/; s/$/"/')" "$sg")
  overrides=$(python3 - "$public_url" "$seed_track_url" <<'PY'
import json, sys
public_url, seed_track_url = sys.argv[1], sys.argv[2]
print(json.dumps({
    "containerOverrides": [{
        "name": "app",
        "command": ["node", "scripts/prod-seed.mjs"],
        "environment": [
            {"name": "PUBLIC_URL", "value": public_url},
            {"name": "SEED_TRACK_URL", "value": seed_track_url},
        ],
    }]
}))
PY
)

  task_arn=$(aws ecs run-task \
    --cluster "$cluster" --task-definition "$family" \
    --launch-type FARGATE --region "$REGION" \
    --network-configuration "$network_config" \
    --overrides "$overrides" \
    --query 'tasks[0].taskArn' --output text)
  [ -n "$task_arn" ] && [ "$task_arn" != "None" ] || die "aws ecs run-task did not return a task ARN"

  info "seed task started: $task_arn — waiting for it to stop (timeout ${SEED_TIMEOUT_S}s)"
  if ! timeout "$SEED_TIMEOUT_S" aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn" --region "$REGION"; then
    die "seed task did not stop within ${SEED_TIMEOUT_S}s — check CloudWatch log group /ecs/inbound-demo (stream prefix app)"
  fi

  local exit_code
  exit_code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --region "$REGION" \
    --query 'tasks[0].containers[0].exitCode' --output text)
  if [ "$exit_code" != "0" ]; then
    die "seed task exited with code $exit_code — check CloudWatch log group /ecs/inbound-demo (stream prefix app), task $task_arn"
  fi
  info "seed task completed (exit 0)"
}

print_up_receipt() {
  local base_url="$1" smoke_status="$2"
  local app_repo ollama_repo app_digest ollama_digest git_rev
  app_repo=$(tf_out app_image | cut -d: -f1)
  ollama_repo=$(tf_out ollama_image | cut -d: -f1)
  app_digest=$(aws ecr describe-images --region "$REGION" \
    --repository-name "$(basename "$app_repo")" --image-ids imageTag=latest \
    --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || echo "unknown")
  ollama_digest=$(aws ecr describe-images --region "$REGION" \
    --repository-name "$(basename "$ollama_repo")" --image-ids imageTag=latest \
    --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || echo "unknown")
  git_rev=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

  cat <<EOF

--------------------------------------------------------------------------------
## $(date -u +%Y-%m-%d) — Interview mode: up

- [cmd] \`infra/interview.sh up\` — git rev \`$git_rev\`
- [state] base URL: $base_url$([ "$DNS_AUTO" = "1" ] && printf ' (DNS + HTTPS automated via 1Password Cloudflare token)' || printf ' (manual-DNS posture — raw ALB over http)')
- [state] app image: $app_repo@$app_digest
- [state] ollama image: $ollama_repo@$ollama_digest
- [state] $smoke_status
- [reminder] run \`infra/interview.sh down\` when this session ends
--------------------------------------------------------------------------------

EOF
}

# ---------------------------------------------------------------------------
# down
# ---------------------------------------------------------------------------

cmd_down() {
  require_cmd terraform
  require_cmd aws
  require_tfvars

  if ! tf output alb_dns_name >/dev/null 2>&1; then
    warn "no terraform state / outputs found — stack may already be down."
  fi

  dns_setup
  if [ "$DNS_AUTO" != "1" ] && tf state list 2>/dev/null | grep -q '^cloudflare_record\.'; then
    warn "state contains Cloudflare DNS records but no zone token is available —"
    warn "terraform destroy will fail on them; make the 1Password token readable and retry."
  fi

  confirm "This will DESTROY the inbound-demo AWS stack (ECS, RDS, ALB, ECR, SSM, ACM cert)." "destroy inbound-demo"

  local git_rev
  git_rev=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

  info "terraform destroy"
  # see cmd_up: -input=false + -auto-approve; the typed confirm above is the gate
  tf destroy -input=false -auto-approve

  dns_restore_host

  cat <<EOF

--------------------------------------------------------------------------------
## $(date -u +%Y-%m-%d) — Interview mode: down

- [cmd] \`infra/interview.sh down\` — git rev \`$git_rev\`
- [state] terraform destroy completed — no billable inbound-demo resources should remain
- [note] verify in the AWS console (ECS, RDS, EC2 > Load Balancers, ECR) if in doubt
--------------------------------------------------------------------------------

EOF
}

# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

cmd_status() {
  require_cmd terraform
  require_cmd aws

  if ! tf output alb_dns_name >/dev/null 2>&1; then
    say "no terraform outputs available — stack is likely down (or never applied)."
    return 0
  fi

  local alb_dns cluster service public_prefix base_url
  alb_dns=$(tf_out alb_dns_name)
  cluster=$(tf_out ecs_cluster)
  service=$(tf_out ecs_service)
  public_prefix=$(tf_out public_prefix)
  base_url="http://${alb_dns}${public_prefix}"

  info "terraform outputs"
  say "  alb_dns_name : $alb_dns"
  say "  public_url   : $(tf_out public_url)"
  say "  ecs_cluster  : $cluster"
  say "  ecs_service  : $service"

  info "ECS service state"
  aws ecs describe-services --cluster "$cluster" --services "$service" --region "$REGION" \
    --query 'services[0].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount,deployments:deployments[].{status:status,rolloutState:rolloutState}}' \
    --output table 2>/dev/null || warn "could not describe ECS service (stack may be mid-teardown)"

  info "healthz probe"
  local body ok
  body=$(curl -s -m 10 "$base_url/healthz" 2>/dev/null || true)
  ok=$(printf '%s' "$body" | python3 -c 'import sys,json
try:
    print(str(json.load(sys.stdin).get("ok")).lower())
except Exception:
    print("unreachable")' 2>/dev/null || echo "unreachable")
  say "  $base_url/healthz -> ok=$ok"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

ASSUME_YES=0
CMD="${1:-}"
shift || true
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

case "$CMD" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  -h|--help|"") usage; [ -n "$CMD" ] || exit 1 ;;
  *) die "unknown subcommand: $CMD"; usage; exit 1 ;;
esac

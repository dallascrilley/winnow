#!/usr/bin/env bash
# Interview mode — on-demand bring-up/verify/teardown for the Inbound demo
# stack (ECS Fargate app+ollama sidecar, RDS PG16, ALB, ECR, SSM). One
# session = one `up`, then `down` before you walk away. See
# docs/interview-mode.md for the full runbook, prerequisites, and timings.
#
#   infra/interview.sh up            # apply, push images, roll out, seed, smoke
#   infra/interview.sh status        # read-only: outputs + ECS state + healthz
#   infra/interview.sh down          # destroy (asks for typed confirmation)
#   infra/interview.sh purge-ghost   # empty local tfstate when AWS is already empty
#   infra/interview.sh check-expiry  # exit non-zero if session older than warn/critical hours
#
# Runtime AWS identifiers (ALB DNS name, subnets, security group, image
# repos) are read from `terraform output` or live `aws` queries — those
# change every destroy + re-apply. The stack name prefix `inbound-demo`
# matches `local.name` in infra/main.tf and is the stable probe key.
set -euo pipefail

SCRIPT_DIR="$(unset CDPATH; cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(unset CDPATH; cd -- "$SCRIPT_DIR/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
HEALTHZ_TIMEOUT_S="${HEALTHZ_TIMEOUT_S:-900}"   # 15 min — cold boot is migrations + ollama model load
SEED_TIMEOUT_S="${SEED_TIMEOUT_S:-600}"          # 10 min
POLL_INTERVAL_S=15
SESSION_MARKER="$SCRIPT_DIR/.interview-session.json"
# Soft/hard age thresholds for check-expiry (hours). Override via env.
EXPIRE_WARN_H="${INTERVIEW_EXPIRE_WARN_H:-3}"
EXPIRE_CRITICAL_H="${INTERVIEW_EXPIRE_CRITICAL_H:-6}"

say()  { printf '%s\n' "$*"; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!!\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31mERROR\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<'EOF'
Usage: infra/interview.sh <up|down|status|purge-ghost|check-expiry> [--yes]

  up            Bring the full stack up: terraform apply, build+push images,
                force a fresh ECS deployment, wait for /healthz, run the prod
                seed task, run the smoke test, print a dated receipt block.
  down          Tear the full stack down: terraform destroy (typed confirmation
                required unless --yes), print a teardown receipt.
  status        Read-only: terraform outputs, ECS service state, one healthz probe.
                Detects ghost local state; reports session age from the local marker.
  purge-ghost   Empty local terraform.tfstate when AWS is already empty
                (typed confirmation; --yes skips it).
  check-expiry  Exit 0 if no session or still fresh; 1 if past warn hours;
                2 if past critical hours or AWS probes failed while a marker
                exists. Intended for cron/launchd (no auto-destroy).

  --yes   Skip interactive confirmation (for scripted/CI use). Never
          bypasses the cost banner on `up`. Auto-purges ghost state on `up`.

Env: INTERVIEW_EXPIRE_WARN_H (default 3), INTERVIEW_EXPIRE_CRITICAL_H (default 6).
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

tf_out_or() {
  # tf_out_or <output-name> <default> — raw scalar, or default when missing
  # (stale state after partial teardown may lack newer outputs)
  local v
  v=$(tf output -raw "$1" 2>/dev/null) && [ -n "$v" ] && { printf '%s' "$v"; return 0; }
  printf '%s' "$2"
}

tf_out_json() {
  tf output -json "$1" 2>/dev/null || die "terraform output '$1' not available — did 'terraform apply' run and succeed?"
}

require_tfvars() {
  [ -f "$SCRIPT_DIR/terraform.tfvars" ] || die "$SCRIPT_DIR/terraform.tfvars is missing (needs db_password at minimum) — see docs/interview-mode.md prerequisites."
}

# Managed (non-data) addresses still present in local terraform state.
# Prefer parsing the state JSON directly — `terraform state list` takes ~5s
# even on an empty file because it boots providers.
tf_managed_count() {
  local state_path="$SCRIPT_DIR/terraform.tfstate" n
  if [ ! -f "$state_path" ]; then
    printf '0'
    return 0
  fi
  if n=$(python3 -c 'import json,sys
from pathlib import Path
s=json.loads(Path(sys.argv[1]).read_text() or "{}")
n=0
for r in s.get("resources") or []:
    if r.get("mode")=="data":
        continue
    n += len(r.get("instances") or []) or 1
print(n)' "$state_path" 2>/dev/null); then
    printf '%s' "$n"
    return 0
  fi
  # Fallback if JSON is corrupt — slow but correct.
  tf state list 2>/dev/null | grep -cv '^data\.' || true
}

write_session_marker() {
  # write_session_marker <base_url> <smoke_status>
  local base_url="$1" smoke_status="$2" git_rev started
  git_rev=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  python3 - "$SESSION_MARKER" "$started" "$base_url" "$git_rev" "$smoke_status" \
    "$EXPIRE_WARN_H" "$EXPIRE_CRITICAL_H" <<'PY'
import json, sys
from pathlib import Path
path, started, base_url, git_rev, smoke, warn_h, crit_h = sys.argv[1:8]
Path(path).write_text(json.dumps({
    "started_at": started,
    "base_url": base_url,
    "git_rev": git_rev,
    "smoke_status": smoke,
    "expire_warn_h": float(warn_h),
    "expire_critical_h": float(crit_h),
}, indent=2) + "\n")
PY
  info "session marker written: $SESSION_MARKER (started $started)"
}

clear_session_marker() {
  if [ -f "$SESSION_MARKER" ]; then
    rm -f "$SESSION_MARKER"
    info "session marker cleared"
  fi
}

# Prints: started_at\tage_hours\tbase_url  (or nothing if missing/unreadable)
read_session_marker() {
  [ -f "$SESSION_MARKER" ] || return 1
  python3 - "$SESSION_MARKER" <<'PY'
import json, sys
from datetime import datetime, timezone
from pathlib import Path
raw = Path(sys.argv[1]).read_text()
try:
    d = json.loads(raw)
except Exception:
    sys.exit(1)
started = d.get("started_at") or ""
base = d.get("base_url") or ""
if not started:
    sys.exit(1)
# Accept Z suffix
ts = started.replace("Z", "+00:00")
try:
    t0 = datetime.fromisoformat(ts)
except Exception:
    sys.exit(1)
if t0.tzinfo is None:
    t0 = t0.replace(tzinfo=timezone.utc)
age_h = (datetime.now(timezone.utc) - t0).total_seconds() / 3600.0
print(f"{started}\t{age_h:.3f}\t{base}")
PY
}

report_session_age() {
  # Soft report for status — never fails the command.
  local line started age base
  line=$(read_session_marker 2>/dev/null) || {
    say "  session marker: (none — stack not tracked as an interview session)"
    return 0
  }
  IFS=$'\t' read -r started age base <<<"$line"
  say "  session started: $started  age: ${age}h  base: ${base:-?}"
  say "  expiry thresholds: warn ${EXPIRE_WARN_H}h / critical ${EXPIRE_CRITICAL_H}h"
  # bash can't do float compare portably — use python
  python3 - "$age" "$EXPIRE_WARN_H" "$EXPIRE_CRITICAL_H" <<'PY' || true
import sys
age, warn_h, crit_h = map(float, sys.argv[1:4])
if age >= crit_h:
    print(f"  !! CRITICAL: session age {age:.2f}h >= {crit_h:g}h — run infra/interview.sh down", file=sys.stderr)
elif age >= warn_h:
    print(f"  !! WARN: session age {age:.2f}h >= {warn_h:g}h — tear down soon", file=sys.stderr)
else:
    print(f"  session age ok (< {warn_h:g}h warn)")
PY
}

# True when local state still lists managed resources but the live AWS side
# has no inbound-demo ALB and no active ECS service. That is the "ghost state"
# posture that breaks the next apply after a partial/manual teardown.
# See docs/solutions/tooling/terraform-ghost-state-after-destroy.md.
#
# Returns:
#   0  ghost (safe to purge)
#   1  not ghost (empty state, or AWS still has live resources)
#   2  indeterminate (AWS probe failed — do NOT purge)
is_ghost_state() {
  local n cluster service alb_rc alb_err alb_arn svc_rc svc_err svc_status
  n=$(tf_managed_count)
  n=${n//[[:space:]]/}
  [ -n "$n" ] && [ "$n" -gt 0 ] 2>/dev/null || return 1

  # Fixed names from infra/*.tf locals.name ("inbound-demo"). Do not parse ALB DNS.
  cluster=$(tf_out_or ecs_cluster "inbound-demo")
  service=$(tf_out_or ecs_service "inbound-demo")

  # Capture stderr separately so auth/network failures are not treated as "gone".
  alb_err=$(mktemp "${TMPDIR:-/tmp}/inbound-alb.XXXXXX")
  alb_arn=$(aws elbv2 describe-load-balancers --region "$REGION" --names inbound-demo \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>"$alb_err") && alb_rc=0 || alb_rc=$?
  case "$alb_arn" in
    arn:*) rm -f "$alb_err"; return 1 ;;
  esac
  if [ "$alb_rc" -ne 0 ]; then
    # LoadBalancerNotFound is the only "gone" signal we accept.
    if ! grep -qiE 'LoadBalancerNotFound|Cannot find load balancer' "$alb_err" 2>/dev/null; then
      warn "AWS ALB probe failed (rc=$alb_rc) — cannot classify ghost state safely:"
      sed 's/^/  /' "$alb_err" >&2 || true
      rm -f "$alb_err"
      return 2
    fi
  fi
  rm -f "$alb_err"

  svc_err=$(mktemp "${TMPDIR:-/tmp}/inbound-ecs.XXXXXX")
  svc_status=$(aws ecs describe-services --region "$REGION" \
    --cluster "$cluster" --services "$service" \
    --query 'services[0].status' --output text 2>"$svc_err") && svc_rc=0 || svc_rc=$?
  case "$svc_status" in
    ACTIVE|DRAINING) rm -f "$svc_err"; return 1 ;;
  esac
  if [ "$svc_rc" -ne 0 ]; then
    # Missing cluster/service is fine (stack down). Auth/throttle/network is not.
    if grep -qiE 'Unable to locate credentials|ExpiredToken|AccessDenied|Throttl|Could not connect|NetworkingError|Could not connect to the endpoint' "$svc_err" 2>/dev/null \
       || grep -qiE 'UnauthorizedException|UnrecognizedClientException|InvalidClientTokenId' "$svc_err" 2>/dev/null; then
      warn "AWS ECS probe failed (rc=$svc_rc) — cannot classify ghost state safely:"
      sed 's/^/  /' "$svc_err" >&2 || true
      rm -f "$svc_err"
      return 2
    fi
  fi
  rm -f "$svc_err"

  return 0
}

warn_ghost_state() {
  local n
  n=$(tf_managed_count)
  n=${n//[[:space:]]/}
  warn "GHOST TERRAFORM STATE: local state lists ${n:-?} managed resources, but AWS has no live inbound-demo ALB/ECS service."
  warn "Purge before the next up:  infra/interview.sh purge-ghost"
  warn "Details: docs/solutions/tooling/terraform-ghost-state-after-destroy.md"
}

purge_ghost_state() {
  # Rewrite local state to empty while preserving lineage. Only call after
  # is_ghost_state returned true (or the operator explicitly chose purge-ghost).
  local state_path bak
  state_path="$SCRIPT_DIR/terraform.tfstate"
  [ -f "$state_path" ] || die "no terraform.tfstate at $state_path"
  bak="$SCRIPT_DIR/terraform.tfstate.ghost-purged.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$state_path" "$bak"
  python3 - "$state_path" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
s = json.loads(p.read_text())
empty = {
    "version": s.get("version", 4),
    "terraform_version": s.get("terraform_version", "1.15.6"),
    "serial": int(s.get("serial") or 0) + 1,
    "lineage": s.get("lineage"),
    "outputs": {},
    "resources": [],
    "check_results": None,
}
if not empty["lineage"]:
    raise SystemExit("refusing to purge: state has no lineage")
p.write_text(json.dumps(empty, indent=2) + "\n")
print(f"purged -> serial {empty['serial']} resources 0")
PY
  info "ghost state purged (backup: $bak)"
}

cmd_purge_ghost() {
  require_cmd terraform
  require_cmd aws
  require_cmd python3
  local rc=0
  is_ghost_state || rc=$?
  if [ "$rc" -eq 0 ]; then
    :
  elif [ "$rc" -eq 2 ]; then
    die "AWS probes failed — refusing to purge. Fix credentials/network and retry status."
  else
    local n
    n=$(tf_managed_count)
    n=${n//[[:space:]]/}
    if [ -z "$n" ] || [ "$n" = "0" ]; then
      say "state is already empty — nothing to purge."
      return 0
    fi
    die "state lists managed resources AND AWS still has a live inbound-demo ALB or ECS service — refusing to purge. Run 'status' and tear down with 'down' first."
  fi
  warn_ghost_state
  confirm "Purge local ghost terraform state (AWS already empty)?" "purge ghost state"
  purge_ghost_state
  say "ok — local state empty. Next: infra/interview.sh up"
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
  local del_fail=0 rec_id
  while IFS= read -r rec_id; do
    [ -n "$rec_id" ] || continue
    if ! cf_api DELETE "/zones/${CF_ZONE_ID}/dns_records/${rec_id}" \
        | python3 -c 'import sys,json
sys.exit(0 if json.load(sys.stdin).get("success") else 1)' 2>/dev/null; then
      warn "Cloudflare DELETE failed for record ${rec_id}"
      del_fail=1
    fi
  done < <(printf '%s' "$records" | python3 -c 'import sys,json
for r in json.load(sys.stdin)["result"]:
    print(r["id"])')
  [ "$del_fail" = "0" ] || die "could not clear pre-existing ${DNS_HOST} record(s) — terraform apply would collide. Backup kept at $DNS_BACKUP; nothing applied, no AWS spend."
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

  local ghost_rc=0
  is_ghost_state || ghost_rc=$?
  if [ "$ghost_rc" -eq 0 ]; then
    warn_ghost_state
    if [ "$ASSUME_YES" = "1" ]; then
      info "auto-purging ghost state (--yes)"
      purge_ghost_state
    else
      read -r -p "Purge ghost state now so apply starts clean? [y/N] " reply
      case "$reply" in y|Y|yes|YES) purge_ghost_state ;; *) die "aborted — purge with 'infra/interview.sh purge-ghost' then retry up." ;; esac
    fi
  elif [ "$ghost_rc" -eq 2 ]; then
    die "AWS probes failed while checking for ghost state — fix credentials/network and retry."
  fi

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
  write_session_marker "$base_url" "$smoke_status"

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

  local remaining
  remaining=$(tf_managed_count)
  remaining=${remaining//[[:space:]]/}
  if [ -n "$remaining" ] && [ "$remaining" -gt 0 ] 2>/dev/null; then
    warn "terraform destroy finished but local state still lists $remaining managed resources."
    local ghost_rc=0
    is_ghost_state || ghost_rc=$?
    if [ "$ghost_rc" -eq 0 ]; then
      warn_ghost_state
      warn "auto-purging ghost leftovers so the next up starts clean."
      purge_ghost_state
      remaining=0
    elif [ "$ghost_rc" -eq 2 ]; then
      warn "AWS probes failed — left local state intact. Re-run status when credentials work, then purge-ghost if needed."
    else
      warn "AWS still reports a live inbound-demo ALB or ECS service — inspect before the next up."
    fi
  fi

  cat <<EOF

--------------------------------------------------------------------------------
## $(date -u +%Y-%m-%d) — Interview mode: down

- [cmd] \`infra/interview.sh down\` — git rev \`$git_rev\`
- [state] terraform destroy completed — managed resources remaining in local state: ${remaining:-0}
- [note] verify in the AWS console (ECS, RDS, EC2 > Load Balancers, ECR) if in doubt
--------------------------------------------------------------------------------

EOF

  clear_session_marker
}

# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

cmd_status() {
  require_cmd terraform
  require_cmd aws
  require_cmd python3

  local managed
  managed=$(tf_managed_count)
  managed=${managed//[[:space:]]/}
  managed=${managed:-0}

  # Fast path: empty state file → no terraform CLI boot (~5s saved).
  if [ "$managed" = "0" ]; then
    local has_out=0
    # Only ask terraform for outputs if a state file exists with outputs key.
    if [ -f "$SCRIPT_DIR/terraform.tfstate" ] \
      && python3 -c 'import json,sys;from pathlib import Path;s=json.loads(Path(sys.argv[1]).read_text() or "{}");sys.exit(0 if s.get("outputs") else 1)' \
           "$SCRIPT_DIR/terraform.tfstate" 2>/dev/null; then
      has_out=1
    fi
    if [ "$has_out" = "0" ]; then
      say "no usable terraform outputs available — stack is likely down (or never applied)."
      info "session"
      report_session_age
      return 0
    fi
  fi
  local ghost_rc=0
  is_ghost_state || ghost_rc=$?
  if [ "$ghost_rc" -eq 0 ]; then
    warn_ghost_state
    say "managed resources in local state: $managed"
    say "fix: infra/interview.sh purge-ghost"
    return 0
  elif [ "$ghost_rc" -eq 2 ]; then
    warn "managed resources in local state: $managed — AWS probes failed, not classifying as ghost."
    warn "fix credentials/network, re-run status, then purge-ghost only if AWS is confirmed empty."
    return 2
  fi

  local alb_dns cluster service public_prefix public_url base_url
  alb_dns=$(tf_out_or alb_dns_name "")
  cluster=$(tf_out_or ecs_cluster "")
  service=$(tf_out_or ecs_service "")
  public_prefix=$(tf_out_or public_prefix "/inbound")
  public_url=$(tf_out_or public_url "")
  if [ -z "$alb_dns" ] && [ -z "$cluster" ] && [ -z "$service" ]; then
    say "no usable terraform outputs available — stack is likely down (or never applied)."
    return 0
  fi
  if [ -n "$alb_dns" ]; then
    base_url="http://${alb_dns}${public_prefix}"
  elif [ -n "$public_url" ]; then
    base_url="$public_url"
  else
    base_url=""
  fi

  info "terraform outputs"
  say "  alb_dns_name : ${alb_dns:-<missing>}"
  say "  public_url   : ${public_url:-<missing>}"
  say "  public_prefix: $public_prefix"
  say "  ecs_cluster  : ${cluster:-<missing>}"
  say "  ecs_service  : ${service:-<missing>}"
  say "  managed state: $managed resources"

  info "ECS service state"
  if [ -n "$cluster" ] && [ -n "$service" ]; then
    aws ecs describe-services --cluster "$cluster" --services "$service" --region "$REGION" \
      --query 'services[0].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount,deployments:deployments[].{status:status,rolloutState:rolloutState}}' \
      --output table 2>/dev/null || warn "could not describe ECS service (stack may be mid-teardown or state is stale)"
  else
    warn "ecs_cluster/ecs_service outputs missing — skipping ECS probe"
  fi

  info "healthz probe"
  if [ -z "$base_url" ]; then
    warn "no base URL available — skipping healthz probe"
  else
    local body ok
    body=$(curl -s -m 10 "$base_url/healthz" 2>/dev/null || true)
    ok=$(printf '%s' "$body" | python3 -c 'import sys,json
try:
    print(str(json.load(sys.stdin).get("ok")).lower())
except Exception:
    print("unreachable")' 2>/dev/null || echo "unreachable")
    say "  $base_url/healthz -> ok=$ok"
  fi

  info "session"
  report_session_age
}

# ---------------------------------------------------------------------------
# check-expiry — cron-friendly forgotten-down guard (no auto-destroy)
# ---------------------------------------------------------------------------

cmd_check_expiry() {
  require_cmd python3
  require_cmd aws

  if [ ! -f "$SESSION_MARKER" ]; then
    say "no interview session marker — nothing to expire."
    return 0
  fi

  local line started age base
  line=$(read_session_marker) || die "session marker unreadable: $SESSION_MARKER"
  IFS=$'\t' read -r started age base <<<"$line"
  say "session started: $started  age: ${age}h  base: ${base:-?}"
  say "thresholds: warn ${EXPIRE_WARN_H}h / critical ${EXPIRE_CRITICAL_H}h"

  # If AWS is already empty, clear a stale marker instead of paging forever.
  local alb_err alb_arn alb_rc
  alb_err=$(mktemp "${TMPDIR:-/tmp}/inbound-alb.XXXXXX")
  alb_arn=$(aws elbv2 describe-load-balancers --region "$REGION" --names inbound-demo \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>"$alb_err") && alb_rc=0 || alb_rc=$?
  case "$alb_arn" in
    arn:*)
      rm -f "$alb_err"
      ;;
    *)
      if [ "$alb_rc" -ne 0 ] && ! grep -qiE 'LoadBalancerNotFound|Cannot find load balancer' "$alb_err" 2>/dev/null; then
        warn "AWS ALB probe failed — cannot clear marker safely:"
        sed 's/^/  /' "$alb_err" >&2 || true
        rm -f "$alb_err"
        return 2
      fi
      rm -f "$alb_err"
      warn "marker present but inbound-demo ALB is gone — clearing stale session marker."
      clear_session_marker
      return 0
      ;;
  esac

  python3 - "$age" "$EXPIRE_WARN_H" "$EXPIRE_CRITICAL_H" <<'PY'
import sys
age, warn_h, crit_h = map(float, sys.argv[1:4])
if age >= crit_h:
    print(f"CRITICAL: session age {age:.2f}h >= {crit_h:g}h — run: infra/interview.sh down", file=sys.stderr)
    sys.exit(2)
if age >= warn_h:
    print(f"WARN: session age {age:.2f}h >= {warn_h:g}h — tear down soon: infra/interview.sh down", file=sys.stderr)
    sys.exit(1)
print(f"ok: session age {age:.2f}h < warn {warn_h:g}h")
sys.exit(0)
PY
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
  purge-ghost) cmd_purge_ghost ;;
  check-expiry) cmd_check_expiry ;;
  -h|--help|"") usage; [ -n "$CMD" ] || exit 1 ;;
  *) die "unknown subcommand: $CMD" ;;
esac

#!/usr/bin/env bash
# Cron/launchd wrapper around interview.sh check-expiry.
# On warn/critical, pushes one ntfy alert (deduped per age bucket) and exits
# with the same code as check-expiry. Never destroys the stack.
set -euo pipefail

SCRIPT_DIR="$(unset CDPATH; cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(unset CDPATH; cd -- "$SCRIPT_DIR/.." && pwd)"
CHECK="$SCRIPT_DIR/interview.sh"
STATE_DIR="${INBOUND_EXPIRY_STATE_DIR:-$HOME/.cache/inbound-interview}"
DEDUP_FILE="$STATE_DIR/last-alert.fingerprint"
LOG_PREFIX="[inbound-interview-expiry]"

# Prefer operator alert topic; allow override.
NTFY_TOPIC="${INBOUND_EXPIRY_NTFY_TOPIC:-agent_alerts}"

mkdir -p "$STATE_DIR"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s %s %s\n' "$(ts)" "$LOG_PREFIX" "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "ERROR: required command not found: $1"
    exit 2
  }
}

require_cmd python3
require_cmd aws
[ -x "$CHECK" ] || { log "ERROR: missing executable $CHECK"; exit 2; }

# Capture check-expiry output + rc without aborting under set -e.
set +e
out=$("$CHECK" check-expiry 2>&1)
rc=$?
set -e

printf '%s\n' "$out" | while IFS= read -r line || [ -n "$line" ]; do
  log "$line"
done

# 0 = fine / no session / stale marker cleared — nothing to page.
if [ "$rc" -eq 0 ]; then
  # Clear fingerprint so a later session can alert again from warn.
  rm -f "$DEDUP_FILE"
  exit 0
fi

# Fingerprint: severity + started_at hour so we page once per bucket, not every 30m.
severity="warn"
[ "$rc" -ge 2 ] && severity="critical"
started=$(printf '%s\n' "$out" | sed -n 's/^session started: \([^ ]*\).*/\1/p' | head -1)
fp="${severity}|${started:-unknown}"
if [ -f "$DEDUP_FILE" ] && [ "$(cat "$DEDUP_FILE" 2>/dev/null || true)" = "$fp" ]; then
  log "alert suppressed (duplicate fingerprint: $fp)"
  exit "$rc"
fi

title="Inbound interview stack still up ($severity)"
body=$(printf '%s\n\nRun: cd %s && infra/interview.sh down\n' "$out" "$REPO_ROOT")
click="file://$REPO_ROOT/docs/interview-mode.md"

published=0
if command -v tether >/dev/null 2>&1; then
  if tether push \
    --immediate \
    --critical \
    --topic "$NTFY_TOPIC" \
    --priority high \
    --tags "warning,infra,inbound" \
    --title "$title" \
    --message "$body" \
    --click "$click" \
    --json >/dev/null 2>&1; then
    published=1
    log "tether push ok topic=$NTFY_TOPIC"
  else
    log "tether push failed — trying ntfy CLI"
  fi
fi

if [ "$published" -eq 0 ] && command -v ntfy >/dev/null 2>&1; then
  if ntfy publish \
    -p high \
    -t "$title" \
    -T "warning,infra,inbound" \
    "$NTFY_TOPIC" \
    "$body" >/dev/null 2>&1; then
    published=1
    log "ntfy publish ok topic=$NTFY_TOPIC"
  else
    log "ntfy publish failed"
  fi
fi

if [ "$published" -eq 1 ]; then
  printf '%s\n' "$fp" >"$DEDUP_FILE"
else
  log "ERROR: could not publish alert (no tether/ntfy success) — still exiting $rc"
fi

exit "$rc"

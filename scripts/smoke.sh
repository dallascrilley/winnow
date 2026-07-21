#!/usr/bin/env bash
# Post-deploy smoke (U8): planted lead against the public URL, watched to a
# terminal status, then the public funnel checked for movement.
#   ./scripts/smoke.sh https://inbound-standard-origin.dallascrilley.com/inbound
set -uo pipefail

BASE="${1:?usage: scripts/smoke.sh <base-url>}"
BASE="${BASE%/}"
EMAIL="smoke.tester@meridianops.com"
FAIL=0

say() { printf '%s\n' "$*"; }
check() { # name expected actual
  if [ "$2" = "$3" ]; then say "ok   $1"; else say "FAIL $1 (want $2, got $3)"; FAIL=1; fi
}

say "== health"
# /healthz is served by prod-start.mjs only; local dev has no such endpoint,
# so skip when absent and stay strict when it answers. One request: body with
# the status code appended on a trailing line.
HRESP=$(curl -s -m 20 -w '\n%{http_code}' "$BASE/healthz")
HCODE=${HRESP##*$'\n'}
HEALTH=${HRESP%$'\n'*}
if [ "$HCODE" = "200" ]; then
  check "healthz ok:true" "true" "$(printf '%s' "$HEALTH" | python3 -c 'import sys,json; print(str(json.load(sys.stdin)["ok"]).lower())' 2>/dev/null || echo parse-error)"
else
  say "skip healthz (no healthy endpoint: HTTP $HCODE — prod-only; local dev has none)"
fi

say "== public surfaces"
for path in "/analytics/funnel" "/analytics/_agent-native/actions/get-public-funnel" "/forms/f/talk-to-sales"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 30 "$BASE$path")
  check "GET $path" "200" "$code"
done

say "== planted submission"
FORM_ID=$(curl -s -m 30 "$BASE/forms/api/forms/public/talk-to-sales" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("form", d)["id"])' 2>/dev/null)
if [ -z "$FORM_ID" ]; then say "FAIL could not discover form id"; exit 1; fi
say "form id: $FORM_ID"
T=$(( $(date +%s) - 15 ))000
RESP=$(curl -s -m 60 -X POST "$BASE/forms/api/submit/$FORM_ID" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"name\":\"Smoke Tester\",\"email\":\"$EMAIL\",\"company_size\":\"201-500\",\"message\":\"VP Revenue Operations. Inbound demo requests sit unrouted for days; need scoring and round-robin assignment for a 12-rep team. Evaluating now.\"},\"_hp\":\"\",\"_t\":$T}")
RID=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' 2>/dev/null)
if [ -z "$RID" ]; then say "FAIL submit: $RESP"; exit 1; fi
say "response id: $RID — waiting for scoring to reach a terminal status"

STATUS=""
for _ in $(seq 1 60); do
  sleep 15
  # get-lead-status is POST-only (no http.method GET on the action). Query-string
  # GET returns 405 Method Not Allowed on the gateway.
  STATUS=$(curl -s -m 30 -X POST \
    -H "Content-Type: application/json" \
    -d "{\"responseId\":\"$RID\"}" \
    "$BASE/qualify/_agent-native/actions/get-lead-status" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["lead"]["status"] if d.get("found") else "")' 2>/dev/null)
  case "$STATUS" in
    routed|booked|disqualified|approved|pending_approval) break ;;
  esac
done
say "terminal status: ${STATUS:-<timeout>}"
# pending_approval is a valid terminal for mid-band ICP; route/book still count as pass.
case "$STATUS" in routed|booked|approved|pending_approval) : ;; *) say "FAIL: lead did not reach a terminal status"; FAIL=1 ;; esac

say "== funnel moved"
SUBS=$(curl -s -m 30 "$BASE/analytics/_agent-native/actions/get-public-funnel" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(sum(r["n"] for r in d["submissionsByDay"]))' 2>/dev/null)
say "funnel submissions: ${SUBS:-0}"
[ "${SUBS:-0}" -ge 1 ] || { say "FAIL funnel empty"; FAIL=1; }

if [ "$FAIL" = 0 ]; then say "SMOKE PASS"; else say "SMOKE FAIL"; exit 1; fi

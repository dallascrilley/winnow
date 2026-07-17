# Slack wiring (deferred — operator gate)

U5 ships the HITL approval gate in-app (`/qualify/approvals` + `decide-lead-approval`).
The Slack leg — approve/reject from a Slack message, plus a daily digest — is
specified here but not built. It stays small because the gate itself is done:
Slack only adds a second `channel` value on the existing action.

## Why deferred

Creating a Slack workspace is a human step (email verification), and a Slack
app's interactivity URL must reach a publicly reachable host — that only exists
after U8 deploys. The in-app queue already proves the gate end-to-end, including
the audit trail (`actor: human`, `channel: app`). The demo script uses the
in-app queue; Slack is a post-deploy enhancement, not a demo blocker.

## What exists today (verified)

- `decide-lead-approval` accepts `channel` (default `"app"`) and records it in
  the lead's audit JSON — `channel: "slack"` needs no schema change.
- Framework Slack manifest at `packages/core/src/integrations/slack-manifest.ts`
  in the agent-native monorepo (scopes, OAuth, interactivity contract).
- Cross-app call substrate: `packages/shared/src/server/a2a.ts`
  (`siblingActionFetch`) — dispatch can call qualify actions with signed JWTs.

## What gets built when a sandbox exists

1. **Slack app**: free workspace → api.slack.com/apps → "from manifest" using the
   framework manifest → install → `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` into
   `apps/dispatch/.env`. Interactivity URL points at the deployed dispatch app.
2. **Notify on park** (~30 lines in qualify `server/lib/chain.ts`): when a lead
   lands on `pending_approval`, signed-call dispatch to post an interactive
   Approve/Reject message carrying `leadId` + the lead's `statusToken`.
3. **Interactivity handler** (~40 lines in dispatch): verify Slack signature,
   on button click signed-call qualify `decide-lead-approval` with
   `channel: "slack"`. Approve → existing route call; reject → `disqualified`.
4. **Daily digest** (dispatch recurring job, framework `jobs/` convention):
   weekday cron → signed-call qualify `list-leads` for 24h funnel counts +
   pending queue → post summary. The funnel query is the same SQL the U7
   analytics dashboard renders. Not committed before the sandbox exists — a
   cron that posts nowhere is noise.

## Demo fallback

If Slack is never enabled, the demo uses `/qualify/approvals` — same gate,
same audit, zero external dependencies.

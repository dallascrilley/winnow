# Inbound — the agent-native lead router

A public, no-login demo of an AI-run inbound pipeline: a form submission is
enriched, scored for ICP fit by an LLM **with visible reasoning**, parked for
human review when the score is borderline, round-robin routed to the right
AE's calendar, booked, and counted — every stage live on a public dashboard.

**Demo status:** activated on demand, not always-on. The full AWS stack
(ECS Fargate + RDS + ALB) applies clean, gets verified against a real
planted-lead run, and is torn down again rather than left running between
visits — see [Full vs. on-demand](#full-vs-on-demand-a-cost-case-study)
below for why. When active: <https://demos.dallascrilley.com/inbound>. Ask
for a session, or run it yourself locally (`pnpm dev`, fully offline).

Built by Dallas Crilley as a portfolio piece: ten years of owning lead-to-cash
operations, rebuilt as the agent-native version. Composed from the
[Agent Native](https://github.com/BuilderIO/agent-native) framework's
templates and packages — the full composition story, with every fork delta and
discovery, is in [`docs/receipts.md`](docs/receipts.md).

## The 2-minute demo

This is what a visitor sees once the demo is active (or what you'll see
running it locally with `pnpm dev`):

1. **Submit the form** at
   <https://demos.dallascrilley.com/inbound/forms/f/talk-to-sales> — use a
   business email at a mid-market company with a real sentence about inbound
   volume. (Everything is synthetic; nothing you type leaves the demo.)
2. **Watch your qualification** on the status page you're redirected to. It
   polls live: enrichment → the LLM's fit score **and its reasoning** → the
   routing decision. Strong fits auto-route to an AE in about a minute.
3. **Book the meeting** — high-fit leads get a scheduling link with real
   availability from the routed AE's calendar (round-robin over four AEs).
4. **Open the funnel** at
   <https://demos.dallascrilley.com/inbound/analytics/funnel> — submissions,
   stage conversion, tier/segment mix, median time-to-route, and the
   qualifier's golden-set accuracy, all updating live. Your submission just
   moved the numbers.
5. **The human gate:** mid-band scores (0.4–0.79) don't route — they park in
   a review queue. The status page shows the parked state and, once a human
   approves or rejects, the audit timeline names the actor (`human`) and
   channel. Borderline leads never silently book or silently die.

## What's inside (5 apps, 1 workspace)

| App | Role |
| --- | --- |
| `forms` | Intake — forked template; a post-insert hook hands each `talk-to-sales` response to qualify over a signed A2A call |
| `qualify` | The brain — custom app: enrichment, LLM ICP scoring (structured JSON, deterministic decoding), band policy, HITL approval queue, golden eval suite |
| `scheduler` | Routing + booking — forked calendar template composed with `@agent-native/scheduling`: consumer-side rule evaluator, round-robin over AE-owned availability, public booking page |
| `analytics` | Funnel — forked analytics template; qualify emits stage events to its first-party track endpoint; public scoped read + public funnel page, full SQL dashboard for logged-in views |
| `dispatch` | Approval delivery (Slack leg — deferred; see `docs/slack-wiring.md`) |

Cross-app calls use signed A2A JWTs against each app's action HTTP surface
(`packages/shared/src/server/a2a.ts`) — the framework's event bus is
in-process, so workspace siblings compose over HTTP. Environments: local dev
(`pnpm dev` → `http://127.0.0.1:8080/<app>`) and AWS (below).

## The AI engineering story

- **Direct-API agents, not framework lock-in.** Scoring is a plain system +
  user prompt returning strict JSON, parsed and policy-banded in code. The
  LangChain equivalent would be an `LLMChain` with an output parser — here
  it's ~60 lines with full control of decoding (temperature pinned to 0: a
  scorer must give the same answer to the same lead twice), the token-cost
  ledger per lead, and a provider seam (local Ollama `qwen3:4b` by default —
  the demo runs fully offline; `QUALIFY_LLM_PROVIDER=openai` flips to hosted
  `gpt-5-mini`).
- **Tool use as the application surface.** Every operation is a framework
  *action* — the agent calls them as tools, the UI calls the same surface
  over HTTP, and sibling apps call each other's actions with signed A2A
  tokens. There is no second, hidden set of endpoints.
- **Evals as a gate, not a garnish.** 24 golden cases (obvious-fit, mid-band,
  poor-fit, adversarial: free-email, student, vendor pitch, gibberish) run
  through the real enrich→score path. Runs are keyed by model + prompt hash
  (ICP, system prompt, and rules all move the id), so every accuracy move is
  attributable. The suite caught three real defects in one afternoon —
  sampling nondeterminism, free-email over-promotion, and a vendor-pitch
  blind spot: **70.8% → 75% → 87.5% → 95.8%**, each step a prompt/config
  change with receipts. The current accuracy is public on the funnel page.
- **Structured generation you can audit.** Every lead carries the model's
  score, reasoning, model id, and cost, plus an append-only audit timeline
  (system/agent/human actors) that renders publicly on the status page.
- **Human-in-the-loop as policy.** The 0.4–0.79 band parks leads for a human;
  approve → routed, reject → disqualified. The in-app queue proves the gate;
  the Slack interactive version is fully specified in
  [`docs/slack-wiring.md`](docs/slack-wiring.md) and only awaits a sandbox.

## Deploy (AWS, Terraform)

`infra/` provisions the whole thing from clean state: ECR, ECS Fargate (app +
Ollama sidecar), RDS Postgres, ALB + ACM, SSM secrets, optional Cloudflare
DNS.

```bash
infra/interview.sh up            # apply (~15 min) → build+push → healthz → seed → smoke → receipt
infra/interview.sh status        # outputs + ECS + healthz + session age; detects ghost state
infra/interview.sh down          # destroy everything again
infra/interview.sh purge-ghost   # empty local tfstate when AWS is already empty
infra/interview.sh check-expiry  # cron: non-zero if session older than warn/critical hours
```

Full runbook (DNS automation via 1Password, timings, receipts):
[`docs/interview-mode.md`](docs/interview-mode.md).

Each step can also be run by hand (`terraform apply`, `infra/push-images.sh`,
`aws ecs update-service --force-new-deployment`, a `run-task` seed, then
`./scripts/smoke.sh <base-url>`) — the script sequences them and reads
runtime identifiers from `terraform output`, since ALB/subnet/SG names change
on every re-apply. With a zone-capable Cloudflare token in 1Password, `up`
automates DNS + HTTPS; otherwise it prints the records to add by hand (see
the runbook).

The stack applies clean from scratch and is destroyed again between proof
runs rather than left running — see the cost case study below for why, and
[`docs/interview-mode.md`](docs/interview-mode.md) for the activate → verify
→ capture receipts → destroy runbook.

### Full vs. on-demand: a cost case study

The original estimate here was ~$55/month (Fargate 2 vCPU/8 GB,
db.t4g.micro, ALB). A rate-card reconciliation later found that number
missed real Fargate vCPU/memory pricing, RDS storage/IO, the ALB hourly
charge, and public IPv4 — true always-on cost is closer to **$122–125/month**.
Not a rounding error; it changes the tradeoff.

An idle ECS/RDS/ALB stack doesn't prove more by sitting there between
visits than a stack that applies cleanly, passes its planted-lead smoke
test, and gets torn down on a dated receipt trail. So the full stack now
runs as **interview mode**: activate on demand, verify, capture receipts
(Terraform apply/destroy, image digest, health + smoke results), destroy.
Local dev (`pnpm dev`, offline Ollama scoring) stays live at all times for
anyone who wants to run it themselves — `terraform destroy` retires the
managed stack, not the project.

A separate 2026-07-18 **inbound-lite** experiment (stopped EC2 + EIP + wake
Lambda, etc.) is still in the AWS account and is **not** managed by
`infra/interview.sh`. Inventory + teardown notes:
[`infra/RESIDUAL-AWS.md`](infra/RESIDUAL-AWS.md).

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL_BASE` | SSM (Terraform) | `postgres://user:pass@host:5432`; the runner derives one DB per app (`inbound_<app>`) |
| `BETTER_AUTH_SECRET`, `A2A_SECRET` | SSM (Terraform) | Auth signing + cross-app JWT secret |
| `ANALYTICS_PUBLIC_KEY` | SSM (Terraform) | First-party track write key (seed inserts the same value) |
| `QUALIFY_LLM_PROVIDER` / `QUALIFY_LLM_MODEL` | task env | `ollama`/`qwen3:4b` by default; `openai` flips to hosted |
| `OPENAI_API_KEY` | SSM (Terraform, optional) | Only needed for hosted scoring |
| `AGENT_USER_EMAIL` | task env | First-boot auto-account owner email |
| `PUBLIC_URL` / `APP_URL` / `BETTER_AUTH_URL` | task env | Public origin incl. the `/inbound` prefix |

Local dev uses per-app `.env` files instead (gitignored) — see
`apps/*/. env.example`; dotenv does **not** override real env vars, so stale
shell keys shadow `.env` (unset them).

## Honesty notes

- **All data is synthetic.** Companies are seeded fixtures; AEs are
  `@inbound-demo.test`; the "enrichment provider" is a deterministic local
  firmographics table standing in for the production Brave/Trafilatura/Gemini
  pipeline (interface-identical, swap-in ready). Nothing you submit is shared
  anywhere.
- Scores come from a 4B-parameter local model on CPU — expect ~1–2 minutes
  per qualification in the cloud demo. That's a deliberate trade: the demo is
  self-contained, costs $0/score, and proves the loop runs offline.
- The Slack approval leg is specified but not enabled (needs a human to
  create the sandbox workspace); the in-app queue proves the same gate.

## Links

- Demo (when active): <https://demos.dallascrilley.com/inbound> — see
  [Full vs. on-demand](#full-vs-on-demand-a-cost-case-study) and
  [`docs/interview-mode.md`](docs/interview-mode.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Composition receipts: [`docs/receipts.md`](docs/receipts.md)
- Slack wiring spec: [`docs/slack-wiring.md`](docs/slack-wiring.md)
- Dallas: [dallascrilley.com](https://dallascrilley.com) · CV stories:
  lead-to-cash operations, EnrichCRM (enrichment pipeline this demo
  re-implements with synthetic data)

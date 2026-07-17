# Architecture

```txt
                        demos.dallascrilley.com/inbound
                                   │  (ALB :443, ACM cert)
                                   ▼
              ┌──────────────────────────────────────────┐
              │  ECS Fargate task (2 vCPU / 8 GB, ARM64) │
              │                                          │
              │  app container (scripts/prod-start.mjs)  │
              │  ┌────────────────────────────────────┐  │
              │  │ proxy :8080  /<app>/* → loopback   │  │
              │  └────────────────────────────────────┘  │
              │    ├─ :8100 analytics ─┐                 │
              │    ├─ :8101 dispatch   │                 │
              │    ├─ :8102 forms    ──┤  signed A2A JWT │
              │    ├─ :8103 qualify  ──┤  action calls   │
              │    └─ :8104 scheduler ─┘                 │
              │                                          │
              │  ollama sidecar :11434 (qwen3:4b baked)  │
              └───────────────┬──────────────────────────┘
                              │ postgres :5432
                    RDS db.t4g.micro (5 databases,
                    one per app; runner creates them)

 SSM SecureStrings ──► task secrets (auth, A2A, DB base URL, track key)
 CloudWatch ──► /ecs/inbound-demo logs
```

## Request flow (one lead)

1. **forms** `POST /forms/api/submit/<id>` → response row; post-insert hook
   (`server/lib/lead-router.ts`, scoped to `talk-to-sales`) signs an A2A JWT
   and calls **qualify** `process-lead`.
2. **qualify** creates the lead (idempotent on the form response id) and runs
   the chain detached: enrich (deterministic firmographics) → score
   (`qwen3:4b`, strict JSON, `temperature: 0`) → band policy
   (`>=0.8` auto · `0.4–0.79` human review · `<0.4` disqualify).
3. Auto band: qualify calls **scheduler** `route-lead` (signed) →
   consumer-side rule evaluation → round-robin over AE-owned schedules →
   `lead_routes` row; scheduler tells qualify (`update-lead-status`).
4. The submitter's status page (public, capability-keyed by the response
   nanoid) polls `get-lead-status` and renders score, reasoning, and the
   audit timeline. High fits get the public booking page
   (`/scheduler/book/<responseId>`); booking writes back `booked`.
5. Review band: lead parks at `pending_approval`; a human decides in
   `/qualify/approvals` (or Slack once wired) via `decide-lead-approval` —
   approve routes as above, reject disqualifies. Audit records
   `actor: human` + channel.
6. Every transition emits a minimized first-party event to **analytics**
   (`/analytics/track`, public write key). The public `/analytics/funnel`
   page reads fixed server-side aggregates via `get-public-funnel`; the
   generic SQL pipeline stays auth-gated.

## Why these shapes

- **Signed A2A over HTTP, not the event bus** — the framework bus is
  in-process; workspace apps are separate processes (dev) / separate nitro
  servers (prod). Same call shape in both.
- **First-party event projection, not cross-DB dashboard reads** — dashboard
  panels can't read db-admin connections, and anonymous surfaces must be
  capability-scoped projections, never a generic query endpoint.
- **Sidecar Ollama** — the demo must run without hosted LLM keys; a 4B model
  on task CPU is slow (~1–2 min/score) but self-contained and $0/score.
  `QUALIFY_LLM_PROVIDER=openai` flips scoring to hosted `gpt-5-mini` with no
  code change.
- **One RDS, five databases** — cheapest correct isolation; the runner
  creates databases at boot, app db plugins migrate on first connect.

# Winnow

I built Winnow to score and route inbound sales leads the way I used to run
lead-to-cash systems by hand: enrich the submission, score ICP fit with a
visible reasoning trail, park borderline scores for a human, and book the rest
against real AE availability. A 24-case model eval suite gates every accuracy
change in CI.

This monorepo is a portfolio demo. All company and AE data is synthetic. Nothing
you submit in a local run is shared.

## Quickstart (local first)

```bash
pnpm install
cp .env.example .env
# Optional: copy apps/*/.env.example for per-app overrides
pnpm dev
```

Opens a local gateway at `http://127.0.0.1:8080/<app>` (forms, qualify,
scheduler, analytics, dispatch). Scoring defaults to local Ollama
(`qwen3:4b`). To use a hosted model:

```bash
export QUALIFY_LLM_PROVIDER=openai
export OPENAI_API_KEY=...
export QUALIFY_LLM_MODEL=gpt-5-mini   # optional
```

Node `>=22.22.0`, pnpm `10.14.0`.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm eval              # offline 24-case gate (no LLM keys; CI runs this)
pnpm --filter qualify eval:live   # full enrich→score path when a model is up
```

The offline eval is the CI gate: suite shape (exactly 24 cases), required tag
groups, band-policy consistency with labels, enrichment over seeded
firmographics, and stable prompt hashing. Live eval is the model accuracy gate
and needs Ollama or OpenAI.

## What runs where

| App | Role |
| --- | --- |
| `forms` | Intake. A post-insert hook hands each `talk-to-sales` response to qualify over a signed A2A call. |
| `qualify` | Enrichment, LLM ICP scoring (structured JSON, temperature 0), band policy, human review queue, golden eval suite. |
| `scheduler` | Round-robin over AE-owned availability and a public booking page. |
| `analytics` | Funnel: submissions, stage conversion, tier/segment mix, latest eval accuracy. |
| `dispatch` | Approval delivery. Slack wiring is specified in `docs/slack-wiring.md`; the in-app queue is what ships. |

Cross-app calls use signed A2A JWTs (`packages/shared`). The framework event bus
is in-process, so workspace siblings compose over HTTP.

## Pipeline in four steps

1. Submit a form with a business email and a real sentence about inbound volume,
   or use a sample ICP preset.
2. Watch qualification on the status page: enrichment → fit score and reasoning
   → routing decision. Strong fits auto-route. Mid-band scores (0.4-0.79) park
   for human review. Low scores disqualify.
3. Book against the routed AE when the lead auto-routes.
4. Open the funnel for stage conversion and the latest eval accuracy.

## Evals as a gate

24 golden cases cover obvious fit, mid-band, poor fit, and adversarial inputs
(free email, student, vendor pitch, gibberish). Runs are keyed by model and a
prompt hash (ICP text, system prompt, rules, firmographics, case set), so an
accuracy move is attributable. The suite drove a measured climb on local
`qwen3:4b` during development; re-run live eval after prompt changes.

Source of truth:

- Cases: `apps/qualify/server/seed/eval-cases.ts`
- Pure comparison: `apps/qualify/server/lib/eval-core.ts`
- Live runner: `apps/qualify/server/lib/eval-runner.ts`
- CLI: `apps/qualify/scripts/run-eval-cli.ts` (`pnpm eval`)

## Deploy (AWS, optional)

`infra/` provisions ECR, ECS Fargate (app + Ollama sidecar), RDS Postgres,
ALB + ACM, and SSM secrets. Interview mode applies the stack, seeds, smokes,
captures receipts, and tears down so you are not paying for idle ALB/RDS/Fargate
between demos.

```bash
infra/interview.sh up
infra/interview.sh status
infra/interview.sh down
```

Full runbook: [`docs/interview-mode.md`](docs/interview-mode.md).

A public HTTPS demo is not always on. When a session is active it is served from
the ALB path configured in that runbook. Prefer local `pnpm dev` for day-to-day
work.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres URL, or leave blank for per-app SQLite under `apps/<app>/data/` |
| `BETTER_AUTH_SECRET` | Auth signing secret |
| `A2A_SECRET` | Cross-app JWT secret |
| `QUALIFY_LLM_PROVIDER` / `QUALIFY_LLM_MODEL` | `ollama`/`qwen3:4b` by default; `openai` for hosted |
| `OPENAI_API_KEY` | Only for hosted scoring |
| `APP_URL` / `BETTER_AUTH_URL` | Public origin for the workspace |

Copy `.env.example` and the per-app examples. Dotenv does not override real env
vars, so unset stale shell keys if values look wrong.

## Notes

- All data is synthetic. Companies are seeded fixtures; AEs use
  `@inbound-demo.test` addresses. Enrichment is a deterministic firmographics
  table that stands in for a production search + crawl + LLM path.
- Local scoring on a 4B model is slow on CPU (about 1-2 minutes per lead in the
  cloud layout). That is intentional so the demo runs offline at $0 per score.
- Package path `@inbound/shared` is unchanged for import stability. Brand and
  root package name are Winnow; a `@winnow/*` rename is a follow-up.

## Links

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Composition receipts: [`docs/receipts.md`](docs/receipts.md)
- Slack wiring: [`docs/slack-wiring.md`](docs/slack-wiring.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security: [`SECURITY.md`](SECURITY.md)
- Site: [dallascrilley.com](https://dallascrilley.com)

## License

MIT © Dallas Crilley. See [LICENSE](LICENSE).

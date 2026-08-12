---
date: 2026-07-17
subject: Retain Inbound's AWS portfolio value while scaling down its live architecture
focus: A lite public runtime that preserves credible ECS, RDS, ALB, Terraform, and offline-inference proof
mode: repo
axes: [runtime topology, portfolio proof and presentation, inference and model, availability and activation lifecycle, persistence and recovery]
candidates_generated: 40
survivors: 6
---

# Ideation: Retain Inbound's portfolio value with a lite architecture

**Subject & grounding:** Inbound is explicitly a public portfolio hero: five agent-native apps compose a complete lead journey, and the repository already contains Terraform, deployment receipts, architecture rationale, eval history, and a planted-lead smoke test (`README.md:1-14`, `docs/receipts.md:150-162`, `scripts/smoke.sh`). The full ECS Fargate + RDS + ALB stack was chosen as a standard, credible AWS deployment that closed a portfolio skill gap, not because every managed service was intrinsically required by this traffic shape (living plan, Decision Log). A later rate-card reconciliation raised the expected always-on cost from the README's stale ~$55/month to roughly $122-125/month, making architecture permanence materially less valuable than reproducibility.

**Cull summary:** Generated 40 candidates, kept 6. Cut 34 for: redundancy with a stronger dual-profile or proof-run idea (19), operational complexity disproportionate to portfolio traffic (7), weakening the authentic live path through replay-only behavior (5), or insufficient additional leverage beyond simple scheduling/rightsizing (3).

## Ranked ideas

### 1. Two deployment profiles, one proof contract
- **Axis:** Runtime topology; portfolio proof and presentation
- **Basis:** `direct` — The existing application is already one portable container running all five Nitro apps behind one gateway (`scripts/prod-start.mjs:1-25`). Terraform, deploy, seed, and smoke receipts already prove the full ECR + ECS + RDS + ALB + SSM topology (`README.md:82-102`, `docs/receipts.md:150-162`). The original plan names that topology as portfolio evidence intended to close an AWS skill gap, so deleting it would throw away signal; keeping it permanently warm is not required to retain that signal.
- **Why it matters:** A shared `standard` and `lite` deployment story turns the cost reduction into platform-engineering evidence. The full profile remains executable and reviewable; the lite profile serves real visitors using the same image, secrets contract, public path, seeds, and smoke journey, so it cannot drift into a fake demo.
- **What exploring it looks like:** Determine the smallest common deployment contract and compare two lite substrates—one Graviton EC2 host versus Lightsail—by portfolio signal, monthly floor, operational surface, and ability to reuse the existing ARM image, ECR, SSM, CloudWatch, and smoke test.

### 2. Reproducibility replaces idle uptime as the full-stack proof
- **Axis:** Availability and activation lifecycle; portfolio proof and presentation
- **Basis:** `direct` — The README already documents apply, image push, seed, smoke, and destroy from clean state (`README.md:82-102`), while `scripts/smoke.sh` exercises the actual planted-lead journey and funnel movement. First principles: an infrastructure claim is better supported by a recent clean reconstruction and passing outcome than by an environment that happens to have remained allocated.
- **Why it matters:** The canonical ECS/RDS/ALB architecture can be activated periodically or for an interview, verified, have its dated receipts captured, and then be destroyed. This retains current, falsifiable AWS proof while removing nearly all of its idle bill.
- **What exploring it looks like:** Define what a trustworthy proof run must publish—Terraform plan/apply receipt, resource inventory, image digest, health and planted-lead smoke results, cost estimate, teardown receipt, and an expiry/TTL guard—plus how often it must run to remain credible.

### 3. Hosted inference is the live lane; Ollama is the independence drill
- **Axis:** Inference and model; runtime topology
- **Basis:** `direct` — Hosted `gpt-5-mini` is already an environment switch with no scoring rewrite (`README.md:54-61`, `apps/qualify/server/lib/scoring.ts`). The Ollama sidecar is the reason the Fargate task reserves 8 GB, including roughly 4 GB for `qwen3:4b` (`infra/ecs.tf:75-80,132-138`), and the public experience currently accepts 1-2 minute CPU scoring (`README.md:127-129`). The 24-case eval suite already supplies a repeatable offline verification surface (`README.md:66-73`).
- **Why it matters:** The live demo becomes faster and dramatically smaller without surrendering the distinctive provider-independent, runs-offline claim. A dated Ollama eval/latency receipt is stronger evidence of independence than paying to leave the model idle.
- **What exploring it looks like:** Decide whether the offline drill runs locally, as an on-demand ECS task, or during the standard-profile proof run; define the parity evidence that keeps the hosted and offline claims honest without implying identical scores or latency.

### 4. Make the cost correction a public architecture case study
- **Axis:** Portfolio proof and presentation
- **Basis:** `direct` — `README.md:101-102` still carries the original ~$55 estimate, while the living plan records a later ~$122-125 rate-card reconciliation and identifies the omitted Fargate, RDS, ALB, and public-IPv4 costs. `docs/receipts.md` already uses transparent decisions, bugs, and verification as portfolio evidence rather than hiding the messy parts.
- **Why it matters:** A visible “full versus lite” architecture narrative demonstrates estimation, observability, FinOps, tradeoff analysis, and corrective judgment. That is more senior portfolio evidence than silently swapping infrastructure or leaving an obviously oversized stack online.
- **What exploring it looks like:** Choose the smallest compelling presentation: architecture diagrams, monthly cost breakdown, capability matrix, decision record, latest full-stack verification date, and the explicit boundary between currently live, periodically proven, and locally reproducible capabilities.

### 5. Treat synthetic state as a portable golden-state package
- **Axis:** Persistence and recovery
- **Basis:** `direct` — All public data is synthetic (`README.md:120-129`); the production runner creates five databases at boot (`scripts/prod-start.mjs:30-49`); and the production seed orchestrator already restores forms, sales-team, routing, dashboard, and eval state (`docs/receipts.md:159`). RDS is technically justified by Postgres-only analytics, but continuous RDS uptime is not required to preserve synthetic portfolio state.
- **Why it matters:** A versioned export/restore contract makes the lite host disposable, enables periodic restoration into real RDS, and turns backup/recovery into additional database-engineering evidence. It also prevents the full and lite demos from showing incoherent or stale fixture states.
- **What exploring it looks like:** Define the golden state's contents, freshness and privacy rules, restore-time target, validation query set, and how a lite local Postgres volume and a temporary RDS instance prove they hydrate to the same visible funnel.

### 6. Add an interview mode instead of an always-on enterprise mode
- **Axis:** Availability and activation lifecycle; portfolio proof and presentation
- **Basis:** `reasoned` — The README's primary experience is a bounded two-minute walkthrough (`README.md:16-35`), while portfolio demand is sparse and high-value sessions are usually known in advance. Paying production-style availability for every hour adds little evidence; a one-command, time-limited full environment can concentrate the spend where the richer infrastructure story will actually be inspected.
- **Why it matters:** A scheduled or manually activated enterprise profile preserves a polished live ECS/RDS/ALB demonstration for interviews, launch windows, and deeper technical reviews. Automatic expiry keeps a forgotten demo session from recreating the current cost problem.
- **What exploring it looks like:** Resolve the operator experience—activation trigger, readiness signal, DNS behavior, warm-up allowance, lease length, automatic teardown, failure rollback, and what a visitor sees before or after the interview window—without designing a public self-service provisioning system.

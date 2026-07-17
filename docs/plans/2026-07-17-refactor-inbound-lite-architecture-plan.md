---
date: 2026-07-17
origin: docs/ideation/2026-07-17-inbound-portfolio-value-lite-architecture.md
td_epic: none
---

# Inbound Dual-Profile AWS Architecture

Living document. Update **Progress**, **Surprises & Discoveries**, **Decision Log**, **Outcomes & Retrospective**, and **Revision History** whenever implementation stops or a decision changes. This repository has no `docs/PLANS.md`; this document follows the Hub `plan` skill's full-plan contract.

## Purpose / Big Picture

Inbound should remain a genuine, always-available public demo without paying production-style managed-service rent for portfolio traffic. The finished system has two AWS profiles that share the same application image, environment contract, seeds, and planted-lead smoke test:

- **Lite** is the live profile. One ARM64 EC2 host runs Caddy, the existing five-app container, and PostgreSQL 16. Hosted `gpt-5-mini` performs live scoring. ECR, SSM Parameter Store, CloudWatch Logs, encrypted EBS, S3 backups, IAM roles, Terraform, and the public Cloudflare path remain real and continuously exercised.
- **Standard** is the proof profile. The existing ECS Fargate + Ollama + RDS + ALB + ACM topology remains intact as code, but runs only for a clean rebuild, interview, or periodic proof. Each run applies from clean state, pushes immutable images, seeds, passes the same smoke test, publishes a sanitized receipt, and destroys its billable resources.

The stable visitor URL remains `https://demos.dallascrilley.com/inbound`. That hostname is a shared Cloudflare Pages demo hub, so a path-scoped Pages Function proxies only `/inbound*` to the selected origin. Neither AWS profile owns or replaces the shared hostname's DNS.

```text
Visitor
  |
  v
demos.dallascrilley.com/inbound  (shared Cloudflare Pages host)
  |
  +-- /inbound* Pages Function --> inbound-origin.dallascrilley.com
                                      |
                                      v
                                 Elastic IP :443
                                      |
                                  Caddy container
                                      |
                             app container :8080
                         five Nitro apps + gateway
                                      |
                              PostgreSQL 16 container

EC2 instance role --> ECR image pull | SSM secret read | S3 backup write
Docker awslogs ----> CloudWatch Logs

Standard proof window only:
inbound-standard-origin.dallascrilley.com/inbound
  --> ALB/ACM --> ECS app + Ollama --> RDS PostgreSQL
  --> seed --> smoke --> sanitized receipt --> terraform destroy
```

## Progress

- [x] (2026-07-17 17:01Z) Ranked 40 ideas into six portfolio-preserving survivors in `docs/ideation/2026-07-17-inbound-portfolio-value-lite-architecture.md`.
- [x] (2026-07-17 17:10Z) Rechecked live AWS state: RDS and ALB are active, but ECS has zero running tasks, one pending task, no registered targets, and a missing Ollama ECR digest error.
- [x] (2026-07-17 17:15Z) Selected the dual-profile architecture and resolved EC2 versus Lightsail, public routing, inference, persistence, and proof-run decisions.
- [ ] U1. Recover and prove the existing standard profile.
- [ ] U2. Qualify hosted inference for the live profile.
- [ ] U3. Make the runtime portable across RDS and local PostgreSQL.
- [ ] U4. Build and prove the lite EC2 profile.
- [ ] U5. Make synthetic state portable and recovery-tested.
- [ ] U6. Turn the standard profile into a bounded proof/interview mode.
- [ ] U7. Cut over the shared demo route and retire always-on standard resources.
- [ ] U8. Publish the architecture and FinOps case study.

## Requirements

- **R1.** `https://demos.dallascrilley.com/inbound` remains the stable, no-login public URL and completes the existing form → score → route → booking → funnel journey.
- **R2.** Lite is a real AWS deployment, not a static replay: the five apps, PostgreSQL writes, hosted model call, audit trail, and funnel movement execute live.
- **R3.** The lite AWS base must cost at most **$35/month** before model calls and low-volume logs/backups. The expected base is about **$30.58/month**: t4g.medium $24.53, 30 GB gp3 $2.40, and one public IPv4 $3.65 at the 2026-07-17 us-east-1 rate card.
- **R4.** With one standard proof run of at most 24 hours per month, total AWS infrastructure must remain at most **$40/month** before model calls. Every proof run has a $5 estimated ceiling and ends with a verified teardown.
- **R5.** Lite and standard use the same application Dockerfile, app image digest, environment variable names, production seed contract, and `scripts/smoke.sh` behavior.
- **R6.** Live scoring uses the pinned `gpt-5-mini-2025-08-07` snapshot only after credential, accuracy, stability, latency, and cost gates pass. Offline `qwen3:4b` remains a periodically executed independence proof.
- **R7.** PostgreSQL state is recoverable from a versioned golden-state backup. The accepted demo RPO is 24 hours and the restore-time target is 15 minutes.
- **R8.** Secrets never enter Git, Terraform source, EC2 user data, command output, receipts, or container images. The instance retrieves SecureStrings through an IAM role into a root-readable runtime env file.
- **R9.** Lite exposes only ports 80 and 443. PostgreSQL and the app gateway stay on the Compose network; port 22 remains closed and operator access uses SSM Session Manager.
- **R10.** Standard ECS, RDS, ALB, ACM, ECR, SSM, CloudWatch, ARM64, and offline Ollama claims remain reproducible and backed by a dated green receipt, not merely retained source files.
- **R11.** Cutover is reversible without data loss. Standard resources are destroyed only after lite passes direct-origin and edge-path smoke tests, a fresh backup restores successfully, and the user explicitly approves the destructive step.
- **R12.** Public documentation distinguishes **live**, **periodically proven**, and **local/offline-capable** surfaces and replaces the stale ~$55/month claim with measured, dated figures.

## Surprises & Discoveries

- The standard profile is currently unhealthy for a new reason: ECS task definition revision 1 resolves an Ollama image digest that no longer exists in ECR. This supersedes the earlier assumption that rebuilding only the SSL-fixed app image was sufficient.
- `demos.dallascrilley.com` is the shared `demo-lab` Cloudflare Pages custom domain, not an Inbound-owned hostname. The original Terraform output that asks for a hostname-level CNAME to the ALB would hijack every portfolio demo and must not be followed.
- The stable public route already has a cross-repo edge ownership chain: `../job-search/demo-lab` owns `demos.dallascrilley.com`, and `../job-search/edge/demo-router` maps `dallascrilley.com/demos/*` into it. Inbound needs a path-scoped adapter in both surfaces.
- RDS requires `sslmode=require`, but the lite Postgres container does not provide TLS. `scripts/prod-start.mjs` and `scripts/prod-seed.mjs` currently hardcode RDS behavior and therefore need an explicit database transport contract.
- The last OpenAI credential probe reached the API but returned `insufficient_quota`. Hosted inference is a real cutover gate, not a documentation-only environment switch.
- The Inbound repository has no `.todos/` database. Existing career-ops task `td-48285e` still owns the unfinished U8 standard deployment; this plan does not initialize or duplicate tracker state.

## Decision Log

- **Decision:** Use one on-demand `t4g.medium` EC2 instance with 30 GB encrypted gp3 for lite. **Rationale:** It reuses the existing ARM64 image and preserves EC2, Graviton, IAM instance profiles, ECR, SSM, CloudWatch, and Terraform signal. Lightsail is about $6.58/month cheaper at 4 GB, but sacrifices several of those portfolio surfaces and requires a separate x86 image path. **Date/Author:** 2026-07-17 / Codex.
- **Decision:** Keep `infra/` as the standard Terraform root and add an independent `infra/lite/` root. **Rationale:** Moving the live standard resources between modules or states adds risky Terraform address migration without reducing runtime cost. Independent names and state let either profile be created or destroyed without coupling.
- **Decision:** Preserve the shared demo hostname through a Cloudflare Pages Function, with `inbound-origin.dallascrilley.com` for lite and `inbound-standard-origin.dallascrilley.com` for standard proof. **Rationale:** Path routing belongs at the existing demo hub; hostname-level DNS changes are unsafe.
- **Decision:** Use Caddy as the lite origin proxy. **Rationale:** A hostname plus open ports 80/443 gives automatic certificate issuance/renewal and a small reverse-proxy configuration, removing ALB and ACM cost from lite while retaining HTTPS.
- **Decision:** Use hosted inference for live visitors and Ollama only in the standard proof lane. **Rationale:** Ollama accounts for roughly half of the current 8 GB task allocation and creates 1–2 minute scoring latency. The existing provider seam and eval suite preserve independence more credibly through dated execution evidence than idle memory.
- **Decision:** Keep PostgreSQL local to lite and back it up to private versioned S3. **Rationale:** Analytics genuinely requires Postgres, but synthetic portfolio data does not justify always-on RDS. Recovery testing becomes additional portfolio evidence.
- **Decision:** Do not build a static replay, visitor wake button, queue, serverless rewrite, or scheduled office hours. **Rationale:** Those ideas add product complexity or weaken R2. A small always-on host is already within the target budget.
- **Decision:** Default standard proof mode is apply → verify → destroy in one operator session. Interview mode may retain it temporarily only with an explicit keep decision and teardown command. **Rationale:** Default behavior must fail toward low spend.

## Outcomes & Retrospective

No implementation outcomes yet. At completion, record the actual lite monthly run rate, hosted-model eval results, restore time, standard proof-run cost, cutover downtime, and whether t4g.small passed the post-cutover rightsizing gate.

## Context and Orientation

The application already has the right consolidation boundary. `Dockerfile` builds all five apps, and `scripts/prod-start.mjs` starts analytics, dispatch, forms, qualify, and scheduler behind one gateway on port 8080. `scripts/prod-seed.mjs` hydrates the five logical databases, and `scripts/smoke.sh` proves health, three public surfaces, a planted submission, terminal routing, and funnel movement.

The standard AWS root under `infra/` owns two ECR repositories, one 2 vCPU/8 GB ARM64 Fargate task with app and Ollama containers, one private Single-AZ `db.t4g.micro` PostgreSQL 16 instance, one internet-facing ALB across six default subnets, ACM, SSM SecureStrings, and CloudWatch logs. At 2026-07-17 17:10Z, RDS and ALB were active while ECS had no running task and no registered target. The latest service event named a missing `inbound-demo-ollama` image digest.

The live public hostname is outside this repository. `../job-search/demo-lab` is the Cloudflare Pages project attached to `demos.dallascrilley.com`. `../job-search/edge/demo-router/worker.js` maps `dallascrilley.com/demos/*` to that origin. U7 therefore requires an isolated job-search worktree and its own review/deploy gate.

## Plan of Work

First, recover the existing standard stack and capture one incontestable green baseline. This prevents cost optimization from becoming an excuse to retire infrastructure that never passed production smoke. In parallel with no public cutover, prove a funded pinned OpenAI model against the existing eval suite and record its cost/latency/stability.

Next, make the application image profile-neutral: database SSL mode becomes explicit, smoke output stops assuming Ollama, and the app image build/push path becomes reusable. Then add the independent lite Terraform root and Compose runtime. Prove it first at its origin hostname, with secrets fetched through the EC2 role and logs reaching CloudWatch.

After lite is healthy, create and restore the golden-state backup into a fresh database volume. Add the bounded standard proof command and sanitized receipt format while the current standard state is still available for comparison. Only then add the path-scoped Cloudflare adapter, cut the public route to lite, observe it, and request approval to destroy standard billable resources.

Finally, update the portfolio narrative. The public repository should show the two profiles, proof freshness, actual costs, recovery evidence, and the architectural correction from overbuilt managed services to a right-sized live system.

## Implementation Units

### U1. Recover and prove the standard profile

- **Goal:** Produce a green, dated baseline for the existing ECS + Ollama + RDS + ALB stack before any migration.
- **Requirements:** R5, R10, R11.
- **Files:** `infra/push-images.sh`, `infra/*.tf`, `scripts/prod-seed.mjs`, `scripts/smoke.sh`, `docs/receipts/aws-standard-baseline.md`, `.agents-state/handoff.md`.
- **Approach:** Inspect ECR tags/digests and Terraform drift; replace the unsafe shared-host default with `inbound-standard-origin.dallascrilley.com`; rebuild and push both ARM64 images from the SSL-fixed HEAD; apply Terraform; force a new ECS deployment; wait for a running task and healthy target; seed; and run the planted-lead smoke against the standard origin. If its manual DNS record is not yet present, run the functional smoke against the ALB HTTP URL and record ACM/DNS as a separate operator gate rather than claiming HTTPS proof.
- **Tests:** Verify the app image contains commit `e8109ec` or later; both ECR digests exist; ECS resolves the new digests; RDS connections use `sslmode=require`; `/healthz` reports all five apps; the planted lead reaches `routed`, `booked`, or `approved`; the funnel count increases.
- **Verification:** `terraform -chdir=infra fmt -check`, `terraform -chdir=infra validate`, and `aws ecs wait services-stable --cluster inbound-demo --services inbound-demo --region us-east-1` must pass. Resolve the target group with `aws elbv2 describe-target-groups --names inbound-demo --query 'TargetGroups[0].TargetGroupArn' --output text`, require its target state to be `healthy`, and run `./scripts/smoke.sh "$(terraform -chdir=infra output -raw public_url)"`. Commit a sanitized receipt containing UTC timestamp, Git SHA, image digests, task-definition revision, resource sizes, smoke result, and observed hourly estimate.

### U2. Qualify hosted inference for live traffic

- **Goal:** Establish that the funded pinned hosted model is accurate, stable, fast, and cheap enough to replace always-on Ollama in lite.
- **Requirements:** R2, R3, R6, R8.
- **Files:** `apps/qualify/server/lib/scoring.ts`, `apps/qualify/server/lib/scoring.test.ts`, `apps/qualify/server/lib/eval-runner.ts`, `apps/qualify/seeds/latest-eval-run.json`, `docs/receipts/hosted-inference.md`.
- **Approach:** Complete the secrets discovery gate without printing values; make a bounded authenticated API probe; pin `QUALIFY_LLM_MODEL=gpt-5-mini-2025-08-07`; and run the 24-case suite three times with the same prompt hash. Preserve the existing score parsing, policy bands, token ledger, and error redaction. Do not alter golden labels to improve the hosted score.
- **Tests:** Add/extend unit coverage for hosted request shape, structured JSON parsing, usage/cost accounting, missing credentials, and provider errors. Across three live eval runs, each accuracy must be at least 90%, no more than one case may change routing band between runs, median scoring latency must be under 20 seconds, and average model cost must be under $0.01 per lead.
- **Verification:** `pnpm --filter qualify test`, three owner-authenticated `run-eval` executions, and a receipt containing model snapshot, prompt hash, accuracy/tag breakdown, disagreement count, p50/p95 latency, total tokens, and total cost. A quota or credential failure blocks U7 cutover but does not block U3–U6 construction.

### U3. Make the runtime profile-neutral

- **Goal:** Run the identical app image against TLS-required RDS or non-TLS local Postgres without weakening the standard default.
- **Requirements:** R5, R8.
- **Files:** `scripts/lib/database-url.mjs`, `scripts/lib/database-url.test.mjs`, `scripts/prod-start.mjs`, `scripts/prod-seed.mjs`, `scripts/smoke.sh`, `scripts/push-app-image.sh`, `infra/push-images.sh`, `infra/ecs.tf`, `infra/variables.tf`, `Dockerfile`, `README.md`.
- **Approach:** Extract a pure database URL builder with `DATABASE_SSLMODE=require` as the default and `disable` only when lite sets it explicitly. Reuse it in start and seed. Make smoke messaging provider-neutral and retain the existing 15-minute ceiling. Extract the app-only ARM64 build/push path so standard adds the Ollama build while lite pushes the same app image to its own ECR repository. Return the pushed content digest and add an explicit standard `app_image_ref` input so both profiles deploy immutable references to the same image content rather than resolving mutable `latest` tags at task start.
- **Tests:** Write the URL-helper test first for query-free and query-bearing base URLs, five database names, default `require`, explicit `disable`, and invalid mode rejection. Run the production image with Postgres 16 in a local Compose fixture using `disable`, and confirm the same image still constructs `require` URLs for standard.
- **Verification:** `node --test scripts/lib/database-url.test.mjs`, `bash -n scripts/smoke.sh scripts/push-app-image.sh infra/push-images.sh`, `pnpm typecheck`, `pnpm -r test`, `pnpm build`, and a local container `/inbound/healthz` plus public-action smoke.

### U4. Build and prove the lite EC2 profile

- **Goal:** Provision the always-on ≤$35/month AWS origin and run the complete live workflow there.
- **Requirements:** R1, R2, R3, R5, R8, R9.
- **Files:** `infra/lite/main.tf`, `infra/lite/variables.tf`, `infra/lite/outputs.tf`, `infra/lite/network.tf`, `infra/lite/iam.tf`, `infra/lite/ecr.tf`, `infra/lite/ssm.tf`, `infra/lite/compute.tf`, `infra/lite/logs.tf`, `infra/lite/runtime/compose.yaml`, `infra/lite/runtime/Caddyfile`, `infra/lite/runtime/app-entrypoint.sh`, `infra/lite/runtime/inbound-lite.service`, `infra/lite/user-data.sh.tftpl`, `infra/lite/push-image.sh`, `infra/lite/deploy.sh`.
- **Approach:** Create an independent `inbound-lite` state and resource namespace. Provision one `t4g.medium`, encrypted 30 GB gp3 root volume, Elastic IP, IAM role/instance profile, ECR repository, SSM SecureStrings, CloudWatch log group, security group for 80/443 only, and budget alarm inputs stored in gitignored tfvars. Require IMDSv2 and SSM Session Manager; do not create a key pair or port-22 rule. User data installs only the runtime prerequisites and checked-in service assets. `deploy.sh` retrieves SecureStrings with `umask 077`, writes one mode-0400 file per secret, logs into ECR, and starts Caddy, app, and PostgreSQL 16 through Compose. PostgreSQL uses its supported password-file input; the app mounts secret files read-only and `app-entrypoint.sh` exports their values inside the container process immediately before executing `scripts/prod-start.mjs`, so values are absent from Compose config and Docker inspect. Caddy proxies the full `/inbound` path to port 8080 and persists ACME state. Docker uses the `awslogs` driver. Set non-secret `DATABASE_SSLMODE=disable`, `QUALIFY_LLM_PROVIDER=openai`, and the pinned snapshot only in lite.
- **Tests:** Terraform policy assertions cover instance type, encryption, IMDSv2, no SSH ingress, no public Postgres/app port, and private S3/log resources. Compose config must resolve with placeholder env names only. Reboot the instance and verify automatic recovery. Stop the app container and verify systemd/Compose restarts it. Confirm no secret value appears in user data, Terraform plan text, Docker inspect output, or CloudWatch logs.
- **Verification:** `terraform -chdir=infra/lite fmt -check`, `terraform -chdir=infra/lite init`, `terraform -chdir=infra/lite validate`, `docker compose -f infra/lite/runtime/compose.yaml config`, direct-origin `curl` checks, and `./scripts/smoke.sh https://inbound-origin.dallascrilley.com/inbound`. The first `terraform -chdir=infra/lite plan -detailed-exitcode` must return 2 with only intended resources; the post-apply run must return 0. Record actual EC2/EBS/IPv4/ECR/S3/CloudWatch rate-card inputs. U4a may downsize to `t4g.small` only after a 24-hour run shows zero OOM/restarts and p95 host memory below 1.5 GB; otherwise t4g.medium remains final.

### U5. Make synthetic state portable and recovery-tested

- **Goal:** Meet the 24-hour RPO and 15-minute restore target without always-on RDS.
- **Requirements:** R7, R8, R11.
- **Files:** `infra/lite/backup.tf`, `infra/lite/runtime/inbound-backup.service`, `infra/lite/runtime/inbound-backup.timer`, `scripts/backup-golden-state.sh`, `scripts/restore-golden-state.sh`, `scripts/verify-golden-state.mjs`, `docs/receipts/golden-state-recovery.md`.
- **Approach:** Create a private, versioned, encrypted S3 bucket with public access blocked and a 30-day noncurrent-version lifecycle. A daily systemd timer exports all five databases in custom format, writes a manifest containing schema/app Git SHA, image digest, database list, row-count checksums, eval model/prompt hash, and UTC time, then uploads without logging credentials or data. Restore creates fresh databases, applies the existing app migrations/seeds where required, imports the dumps, and runs fixed integrity queries.
- **Tests:** Corrupt or omit one archive and require restore to fail before replacing live state. Restore the latest package into a fresh Postgres volume, verify five databases, compare row-count checksums, load the public funnel, and submit a new planted lead. Confirm backup objects and manifests contain no secrets or personal/customer data; only synthetic demo data is allowed.
- **Verification:** `bash -n scripts/backup-golden-state.sh scripts/restore-golden-state.sh`, focused tests for manifest validation, a timed fresh-volume restore under 15 minutes, `scripts/verify-golden-state.mjs`, and a complete `scripts/smoke.sh` pass after restore.

### U6. Turn standard into bounded proof/interview mode

- **Goal:** Make the full AWS topology freshly reproducible for at most $5 per run and zero standard runtime cost between runs.
- **Requirements:** R4, R5, R6, R10.
- **Files:** `infra/proof-standard.sh`, `scripts/capture-standard-receipt.mjs`, `docs/receipts/aws-standard/README.md`, `docs/receipts/aws-standard/latest.json`, `infra/README.md`.
- **Approach:** Add an operator command that validates clean Git ownership, applies standard, pushes both images, forces deployment, seeds, runs the same smoke and offline eval, captures a sanitized receipt, and defaults to `terraform destroy` after success. A deliberate `--keep-for-interview` mode prints the exact cleanup command and cost clock; it never becomes the default. The receipt contains Git SHA, Terraform version, resource inventory/sizes, image digests, smoke and eval outcomes, estimated run cost, and teardown status. It excludes account IDs, private endpoints, secret values, and raw Terraform state.
- **Tests:** Exercise command parsing and receipt sanitization without AWS mutation. Run one real proof after U1 and require `terraform destroy` to remove ECS service/cluster, RDS, ALB/target group/listeners, ACM proof certificate, and standard ECR repositories. Verify lite resources are untouched by exact namespace and state-key checks.
- **Verification:** `bash -n infra/proof-standard.sh`, receipt tests, one full apply-to-destroy run under 24 hours, AWS inventory queries returning no standard billable resources afterward, and a receipt whose `teardown_status` is `verified`. Offline `qwen3:4b` eval accuracy must remain at least 90% and its image digest must be present during the run.

### U7. Cut over the shared demo route and retire always-on standard

- **Goal:** Serve the public Inbound path through lite without changing the shared demo hostname or breaking other demos.
- **Requirements:** R1, R2, R9, R11.
- **Files:** `../job-search/demo-lab/functions/inbound/[[path]].js`, `../job-search/demo-lab/tests/inbound-proxy.test.js`, `../job-search/edge/demo-router/worker.js`, `../job-search/edge/demo-router/worker.test.js`, `../job-search/docs/ops/demo-routing-ownership.md`, `.agents-state/handoff.md`.
- **Approach:** In a separate job-search worktree, add a Pages Function that matches only `/inbound*`, streams method/query/body to the configured `INBOUND_ORIGIN`, strips visitor authorization/cookies and origin-only headers, disables caching for dynamic responses, and preserves status/location/content type. Add `inbound` to the existing flagship/root-path mapping so `dallascrilley.com/demos/inbound` maps to the same Pages path. Configure the Pages environment to use the lite origin; do not hardcode it in source. Prove the lite origin directly, then deploy the edge change after explicit approval because it mutates a public external surface. Observe both public URLs and the planted-lead workflow. Keep the green standard profile available for one rollback window of at most 24 hours. After the window, obtain explicit approval, create/verify the final golden-state backup, run the standard receipt capture, and destroy standard resources.
- **Tests:** The Pages Function test covers GET/POST, query/body streaming, `/inbound` and nested paths, upstream redirect/status propagation, header stripping, and non-Inbound isolation. Existing demo-router tests must remain green, including all prior flagship routes. Browser and curl checks cover `demos.dallascrilley.com/inbound`, `dallascrilley.com/demos/inbound`, at least two unrelated demos, status polling, booking, and funnel movement.
- **Verification:** In job-search, run `pnpm --dir demo-lab test`, `pnpm --dir demo-lab build`, `node --test edge/demo-router/worker.test.js`, and Wrangler dry-runs. After approved deploy, require both Inbound URLs to pass smoke and unrelated demo spot-checks to retain their existing status/headers. Rollback changes only `INBOUND_ORIGIN` back to the still-running standard origin; after standard destruction, rollback restores the latest lite backup onto a replacement lite instance.

### U8. Publish the portfolio and FinOps case study

- **Goal:** Convert the architecture correction into clear, honest senior-level portfolio evidence.
- **Requirements:** R3, R4, R10, R12.
- **Files:** `README.md`, `docs/architecture.md`, `docs/receipts.md`, `docs/cost-case-study.md`, `docs/receipts/aws-standard/latest.json`, `docs/receipts/aws-lite-cost.md`, and the Inbound card/content in `../job-search/demo-lab`.
- **Approach:** Replace the single architecture diagram with live-lite and proof-standard diagrams. Publish the original estimate, corrected rate-card estimate, chosen lite cost, actual first billing observations, and why each service moved or remained. Add a capability matrix labeled live/periodic/local, recovery receipt, hosted/offline eval comparison, latest standard proof timestamp, and a two-minute recruiter path. Update wording so “runs fully offline” describes the verified proof lane, not the continuously live lane. Link the case study from the demo hub without exposing secrets, account details, or internal-only endpoints.
- **Tests:** Run every documented command or mark it as an operator-only destructive command. Check every public URL, image, and receipt link. Confirm the README no longer claims ~$55/month or implies Ollama is always live. Verify the public page communicates the tradeoff within one screen and the deeper receipt remains available for technical reviewers.
- **Verification:** `rg -n '\$55|fully offline|ECS Fargate task \(2 vCPU / 8 GB' README.md docs`, `pnpm fmt:check`, link checks, both public smoke paths, and a fresh AWS cost inventory. Acceptance requires a measured lite base ≤$35/month projection, total ≤$40 with one standard proof run, and no standard billable resources left after teardown.

## Worktree & Concurrency

- **worktree_slug:** `codex/feat/inbound-lite-architecture`
- **spine_owner:** `self`
- **Inbound worktree:** `/Users/dallascrilley/Code/.worktrees/inbound/codex-feat-inbound-lite-architecture`
- **Pre-flight:** The Hub posture script resolves against `~/.hub` and cannot claim Inbound surfaces; use `git worktree list`, exact path ownership, and a separate job-search worktree for U7/U8 edge changes.
- **Active conflicts:** Primary Inbound currently has foreign changes in `apps/qualify/seeds/latest-eval-run.json` and `apps/qualify/server/seed/rerun-eval.temp.ts`. Do not absorb, overwrite, stage, or delete them. U2 must recheck ownership before touching `latest-eval-run.json`; if still active, record hosted receipts in a new file instead.
- **Concurrency:** U2 research/eval and U4 Terraform authoring may proceed in parallel only after U3's runtime contract lands. U5 depends on U4. U6 depends on U1 and the shared push contract from U3. U7 is serialized after U4–U6 and uses its own job-search worktree. U8 follows cutover.

### Write surfaces

- **U1:** `infra/`, `docs/receipts/aws-standard-baseline.md`, `.agents-state/handoff.md`
- **U2:** `apps/qualify/server/lib/`, hosted inference receipts; `apps/qualify/seeds/latest-eval-run.json` only after ownership clears
- **U3:** `scripts/`, `infra/push-images.sh`, `Dockerfile`, `README.md`
- **U4:** `infra/lite/`
- **U5:** `infra/lite/backup.tf`, backup/restore scripts, recovery receipt
- **U6:** `infra/proof-standard.sh`, standard receipt tooling/docs
- **U7:** separate job-search worktree surfaces under `demo-lab/`, `edge/demo-router/`, and `docs/ops/`
- **U8:** Inbound README/docs plus the job-search demo card/content

## Prior Learnings Applied

- `docs/solutions/database/rds-pg16-requires-ssl.md` — standard must default to `sslmode=require`; lite may disable TLS only through an explicit profile setting.
- `docs/solutions/integration/prod-prefix-gateway-base-path.md` — build-time and runtime app base paths remain a slash followed by the app id, external URLs retain `/inbound`, and smoke must test real action/page routes rather than trusting catch-all 200 responses.
- `docs/solutions/tooling/orbstack-docker-buildx-load.md` — local ARM64 builds use `docker buildx build --load`; retry export-phase EOF once before diagnosing Dockerfile failure.
- `docs/solutions/developer-experience/local-pg-ollama-shell-death-recovery.md` — standard/offline proof verifies actual Postgres/Ollama process identity and readiness instead of assuming a live PID or background shell.

## Concrete Steps

Work from the Inbound plan worktree unless a unit explicitly names the job-search worktree.

```bash
cd /Users/dallascrilley/Code/.worktrees/inbound/codex-feat-inbound-lite-architecture
git status --short
pnpm install --frozen-lockfile
```

Before each AWS mutation, capture exact state without printing secrets:

```bash
aws sts get-caller-identity --query Account --output text
aws ecs describe-services --region us-east-1 --cluster inbound-demo --services inbound-demo
aws rds describe-db-instances --region us-east-1 --db-instance-identifier inbound-demo
aws elbv2 describe-load-balancers --region us-east-1 --names inbound-demo
```

Standard baseline and later proof use the existing root:

```bash
terraform -chdir=infra init
terraform -chdir=infra validate
terraform -chdir=infra plan
./infra/push-images.sh
aws ecs update-service --region us-east-1 --cluster inbound-demo --service inbound-demo --force-new-deployment
aws ecs wait services-stable --region us-east-1 --cluster inbound-demo --services inbound-demo
./scripts/smoke.sh "$(terraform -chdir=infra output -raw public_url)"
```

Lite uses its independent root and direct origin before the edge cutover:

```bash
terraform -chdir=infra/lite init
terraform -chdir=infra/lite fmt -check
terraform -chdir=infra/lite validate
terraform -chdir=infra/lite plan
terraform -chdir=infra/lite apply
./infra/lite/push-image.sh
./infra/lite/deploy.sh
./scripts/smoke.sh https://inbound-origin.dallascrilley.com/inbound
```

## Validation and Acceptance

Completion requires all of the following evidence from the same reviewed Git SHA:

1. `pnpm typecheck`, `pnpm -r test`, `pnpm build`, and `pnpm fmt:check` exit 0.
2. Both Terraform roots pass `fmt -check` and `validate`; lite has no unexpected plan after deployment.
3. Lite direct origin and both edge URLs pass the complete planted-lead smoke.
4. Hosted inference passes the three-run accuracy/stability/latency/cost gate.
5. A fresh golden-state restore completes under 15 minutes and then passes smoke.
6. A standard proof run passes smoke and offline eval, produces a sanitized receipt, and ends with verified teardown.
7. AWS inventory shows only lite's intended EC2/EBS/EIP/ECR/SSM/S3/CloudWatch resources; standard ECS/RDS/ALB resources are absent after approval and teardown.
8. The projected lite base is ≤$35/month and the one-proof-run monthly total is ≤$40 before model calls.
9. Unrelated demos still work after the edge change.
10. README/docs accurately label every surface and link to the latest receipts.

## Idempotence and Recovery

Terraform applies, image pushes, seeds, backup uploads, and receipt capture must be repeatable. Lite deployment uses immutable image digests in Compose after the first successful push; `latest` may exist for operator convenience but is not the deployed identity. Seed operations remain idempotent by their existing keys.

If U1 cannot make standard green, do not destroy it or claim proof; record the exact service event/log and continue only with non-destructive lite construction. If U2 lacks funded hosted credentials, build and validate lite infrastructure but do not route public submissions to it. If lite deployment fails, the shared demo route remains unchanged. If edge cutover fails during the rollback window, restore `INBOUND_ORIGIN` to the standard origin and redeploy the Pages project. After standard teardown, recovery is replacement lite infrastructure plus the latest verified golden-state package.

Before destructive standard teardown, save the sanitized receipt, verify the golden-state object and manifest, confirm lite smoke twice at least 15 minutes apart, inspect the exact Terraform destroy plan, and obtain explicit user approval. Never use `-target`, force-unlock without ownership proof, or manual AWS deletion as the normal path.

## Interfaces and Dependencies

- `DATABASE_URL_BASE`: base connection without database name; runtime appends `inbound_` followed by the app id.
- `DATABASE_SSLMODE`: `require` by default; lite explicitly sets `disable`.
- `QUALIFY_LLM_PROVIDER`: `openai` in lite, `ollama` in standard/offline proof.
- `QUALIFY_LLM_MODEL`: pinned hosted snapshot in lite, `qwen3:4b` in standard.
- `WORKSPACE_PUBLIC_PREFIX`: remains `/inbound` in both profiles.
- `INBOUND_ORIGIN`: Cloudflare Pages environment value selecting the current AWS origin; never committed.
- `scripts/smoke.sh "$BASE_URL"`: single outcome contract for local, lite, and standard.
- `scripts/backup-golden-state.sh` / `scripts/restore-golden-state.sh`: S3 package contract with a validated manifest.
- Caddy 2: terminates origin HTTPS and proxies `/inbound*` to app port 8080.
- PostgreSQL 16: five logical databases in one lite container or one standard RDS instance.
- AWS Systems Manager Session Manager: only interactive host access; no SSH key pair or port 22.

## Artifacts and Notes

- Origin ideation: `docs/ideation/2026-07-17-inbound-portfolio-value-lite-architecture.md`
- Existing architecture: `docs/architecture.md`
- Existing composition/deploy evidence: `docs/receipts.md`
- Standard baseline receipt: `docs/receipts/aws-standard-baseline.md`
- Hosted model receipt: `docs/receipts/hosted-inference.md`
- Recovery receipt: `docs/receipts/golden-state-recovery.md`
- Latest standard proof receipt: `docs/receipts/aws-standard/latest.json`
- Cost case study: `docs/cost-case-study.md`

## Deferred / Out of Scope

- Public visitor-triggered wake-up or provisioning.
- Static replay as a substitute for the live workflow.
- Lambda, Aurora Serverless, App Runner, Kubernetes, or a multi-host HA lite topology.
- Automatic scheduled standard proof runs; manual proof is deliberate until cost and cleanup behavior are proven.
- Slack approval sandbox wiring.
- t4g.small as the initial live size; it is evidence-gated U4a only.
- Changing the shared demo hostname's Cloudflare Pages ownership.

## Open Questions

No architecture question remains blocking. Execution still has three operator gates with predetermined fallback behavior: obtain a funded hosted-model credential or stop before cutover; create the two origin DNS records manually if the Cloudflare token remains insufficient; and approve the public edge deployment plus later standard teardown at the moment each external/destructive action is ready.

## Revision History

- 2026-07-17: Initial full plan synthesized from the six ranked ideation survivors, live AWS state, repository deployment receipts, relevant solution notes, current AWS/OpenAI pricing, and shared demo-routing ownership.

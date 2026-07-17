---
date: 2026-07-17
origin: docs/ideation/2026-07-17-inbound-portfolio-value-lite-architecture.md
td_epic: td-af0109
td_units: [td-48285e, td-f93367]
---

# Inbound Dual-Profile AWS Architecture

Living document. Update **Progress**, **Surprises & Discoveries**, **Decision Log**, **Outcomes & Retrospective**, and **Revision History** whenever implementation stops or a decision changes. This repository has no `docs/PLANS.md`; this document follows the Hub `plan` skill's full-plan contract.

## Purpose / Big Picture

Inbound should remain a genuine, always-reachable public demo without paying production-style managed-service rent while nobody is using it. The finished system has two AWS profiles that share the same application image, environment contract, seeds, and planted-lead smoke test:

- **Lite** is the live, hibernating profile. The shared Cloudflare demo hub always serves a launch/status shell. A valid visitor activation wakes one ARM64 EC2 host for a renewable 60-minute lease; the host runs Caddy, the existing five-app container, and PostgreSQL 16, then stops cleanly after the lease expires. Hosted `gpt-5-mini` performs live scoring. ECR, SSM Parameter Store, CloudWatch Logs, encrypted EBS, S3 backups, IAM roles, API Gateway, Lambda, Terraform, and the public Cloudflare path remain real and continuously exercised.
- **Standard** is the proof profile. The existing ECS Fargate + Ollama + RDS + ALB + ACM topology remains intact as code, but runs only for a clean rebuild, interview, or periodic proof. Each run applies from clean state, pushes immutable images, seeds, passes the same smoke test, publishes a sanitized receipt, and destroys its billable resources.

The stable visitor URL remains `https://demos.dallascrilley.com/inbound`. That hostname is a shared Cloudflare Pages demo hub, so a path-scoped Pages Function proxies only `/inbound*` to the selected origin. Neither AWS profile owns or replaces the shared hostname's DNS.

```text
Visitor
  |
  v
demos.dallascrilley.com/inbound  (shared Cloudflare Pages host)
  |
  +-- sleeping --> launch/status shell
  |                  |
  |                  +--> authenticated wake --> API Gateway --> Lambda
  |                                                        |        |
  |                                                        |        +--> start tagged EC2
  |                                                        +----------> renew 60-minute stop lease
  |
  +-- awake --> /inbound* Pages Function --> inbound-origin.dallascrilley.com
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
- [x] (2026-07-17 17:46Z) Reframed lite as an on-demand hibernating origin. Live AWS rates make the fixed idle floor about $6.05/month and a 30-running-hour month about $7.06 before model calls and low-volume usage charges.
- [x] (2026-07-17 20:25Z) U1. Recovered and proved the existing standard profile at Git `126b610`: immutable app and Ollama digests recorded, production seed exited 0, ECS/ALB became healthy, all five apps passed health, and the planted lead reached `routed` with funnel movement. Functional proof used the ALB HTTP origin; standard-origin DNS/ACM remains a separate operator gate.
- [x] (2026-07-17 20:35Z) Completed the U2 credential/probe gate without exposing secret values. Two candidates are invalid and the authenticated candidate returns `insufficient_quota`; hosted eval remains blocked and U7 cannot cut over. Hardened provider errors and recorded the blocker in `docs/receipts/hosted-inference.md`.
- [ ] U2. Qualify hosted inference for the live profile.
- [x] (2026-07-17 20:50Z) Completed the U3 portability implementation: one tested URL builder defaults to `sslmode=require` and permits `disable` only explicitly; a fresh PostgreSQL 16 container accepted the lite URL; standard image inputs are immutable and stack-owned; bootstrap is explicit with ECS at zero; and app-only build/push returns an ECR content ref. Workspace typecheck, 1,045 tests, and all five app builds pass.
- [x] (2026-07-17 22:25Z) Proved U3 on the live standard profile at task definition `inbound-demo:3`: exact app and Ollama digests, explicit `DATABASE_SSLMODE=require`, zero Terraform drift, idempotent production seed with both containers exiting 0, healthy ALB target, all five app health checks, and planted-lead smoke reaching `routed` with funnel submissions at 3. Increased ECS deployment headroom to 200% after the previous 100% setting reproduced a zero-task placement stall.
- [x] U3. Make the runtime portable across RDS and local PostgreSQL.
- [x] (2026-07-17 22:38Z) Prioritized cost containment before U4: scaled ECS to zero, requested an immediate RDS stop, reviewed a 34-resource destroy plan, and removed the complete standard Terraform stack. Residual audit found zero Terraform resources, RDS instances/snapshots, ALBs, ECR repositories, Elastic IPs, log groups, and SSM parameters. Five tagged ECS records remain only as `INACTIVE` control-plane metadata with zero tasks or services. Receipt: `docs/receipts/aws-standard-teardown.md`.
- [ ] U4. Build and prove the hibernating lite EC2 profile and wake control plane.
- [ ] U5. Make synthetic state portable and recovery-tested.
- [ ] U6. Turn the standard profile into a bounded proof/interview mode.
- [ ] U7. Cut over the shared demo route and retire always-on standard resources.
- [ ] U8. Publish the architecture and FinOps case study.

## Requirements

- **R1.** `https://demos.dallascrilley.com/inbound` remains the stable, no-login public URL. It always renders a launch/status shell and, after a cold wake of at most 180 seconds, completes the existing form → score → route → booking → funnel journey.
- **R2.** Lite is a real AWS deployment, not a static replay: the five apps, PostgreSQL writes, hosted model call, audit trail, and funnel movement execute live.
- **R3.** Lite's core stopped-host floor must remain at most **$6.05/month**, its full low-volume idle base must remain at most **$8/month**, and a 30-running-hour month must remain at most **$10/month** before model calls. At the 2026-07-17 us-east-1 rate card, the core estimate is 30 GB gp3 at $2.40/month, one public IPv4 at $3.65/month, and `t4g.medium` compute at $0.0336/hour: **$7.06 at 30 hours** before low-volume ECR, S3, CloudWatch, API Gateway, Lambda, and Scheduler usage, versus $30.58 always-on.
- **R4.** With one standard proof run of at most 24 hours per month, total AWS infrastructure must remain at most **$15/month** before model calls. Every proof run has a $5 estimated ceiling and ends with a verified teardown.
- **R5.** Lite and standard use the same application Dockerfile, app image digest, environment variable names, production seed contract, and `scripts/smoke.sh` behavior.
- **R6.** Live scoring uses the pinned `gpt-5-mini-2025-08-07` snapshot only after credential, accuracy, stability, latency, and cost gates pass. Offline `qwen3:4b` remains a periodically executed independence proof.
- **R7.** PostgreSQL state is recoverable from a versioned golden-state backup. The accepted demo RPO is 24 hours and the restore-time target is 15 minutes.
- **R8.** Secrets never enter Git, Terraform source, EC2 user data, command output, receipts, or container images. The instance retrieves SecureStrings through an IAM role into a root-readable runtime env file.
- **R9.** Lite exposes only ports 80 and 443. PostgreSQL and the app gateway stay on the Compose network; port 22 remains closed and operator access uses SSM Session Manager.
- **R10.** Standard ECS, RDS, ALB, ACM, ECR, SSM, CloudWatch, ARM64, and offline Ollama claims remain reproducible and backed by a dated green receipt, not merely retained source files.
- **R11.** Cutover is reversible without data loss. Standard resources are destroyed only after lite passes direct-origin and edge-path smoke tests, a fresh backup restores successfully, and the user explicitly approves the destructive step.
- **R12.** Public documentation distinguishes **live**, **periodically proven**, and **local/offline-capable** surfaces and replaces the stale ~$55/month claim with measured, dated figures.
- **R13.** Status and wake calls are authenticated server-to-server, rate-limited, idempotent, and expose no AWS identifiers or credentials. Mutating IAM permissions are scoped to the tagged lite instance and one named stop schedule; read-only EC2 describe access uses the minimum wildcard AWS requires. Each valid activation creates or extends one 60-minute lease; the instance stops within five minutes of lease expiry without losing PostgreSQL state.

## Surprises & Discoveries

- The earlier missing-Ollama-digest event was not the final blocker; a valid digest existed and the recovered sidecar runs it successfully. The actual U1 blockers were a stale app image without the RDS SSL fix, task-definition environment drift, CLI seed entrypoints retaining private Drizzle pools, an incorrect Forms response-shape assumption in smoke, and Qwen's default thinking mode exceeding the scoring window.
- The standard ECS service's minimum-healthy 0 / maximum 100 deployment policy drained its only task and then stalled at desired 1, running 0, pending 0. A second force after drain triggered placement. This maintenance window is acceptable for bounded proof mode and is another reason not to use ECS service scheduling as the lite wake primitive.
- The recovered standard task definition still references mutable `latest` tags. The green resolved digests are captured in `docs/receipts/aws-standard-baseline.md`; U3 must convert both profiles to immutable image references.
- A convenient mutable-tag bootstrap would have allowed an ECS task to start with production SSM secrets before immutable refs existed. The final contract makes bootstrap explicit, keeps ECS desired count at zero, and makes a normal plan fail unless both refs match this stack's exact ECR repositories by SHA-256 digest.
- `demos.dallascrilley.com` is the shared `demo-lab` Cloudflare Pages custom domain, not an Inbound-owned hostname. The original Terraform output that asks for a hostname-level CNAME to the ALB would hijack every portfolio demo and must not be followed.
- The stable public route already has a cross-repo edge ownership chain: `../job-search/demo-lab` owns `demos.dallascrilley.com`, and `../job-search/edge/demo-router` maps `dallascrilley.com/demos/*` into it. Inbound needs a path-scoped adapter in both surfaces.
- RDS requires `sslmode=require`, but the lite Postgres container does not provide TLS. `scripts/prod-start.mjs` and `scripts/prod-seed.mjs` currently hardcode RDS behavior and therefore need an explicit database transport contract.
- The last OpenAI credential probe reached the API but returned `insufficient_quota`. Hosted inference is a real cutover gate, not a documentation-only environment switch.
- The full credential discovery gate found three candidates: two return `invalid_api_key`, while the remaining 1Password candidate authenticates but returns `insufficient_quota`. The hosted eval cannot start until a funded credential exists; the probe also revealed and closed an upstream-error-body leakage path in `callOpenAI`.
- The Inbound repository has no `.todos/` database. Existing career-ops task `td-48285e` still owns the unfinished U8 standard deployment; this plan does not initialize or duplicate tracker state.
- Stopping an EBS-backed EC2 instance removes compute charges while preserving EBS data, its network interface, IPv6 addresses, and any Elastic IP. The 30 GB gp3 volume and public IPv4 still cost about $6.05/month, but 30 monthly running hours add only $1.01 of compute.
- Provisioned RDS is not a durable hibernation primitive: it automatically restarts after seven stopped days. Aurora Serverless v2 can auto-pause at 0 ACUs, but adopting it would add an Aurora migration and resume behavior to a workload that can already keep app and PostgreSQL state together on the stopped EC2 host.

## Decision Log

- **Decision:** Use one hibernating on-demand `t4g.medium` EC2 instance with 30 GB encrypted gp3 for lite. **Rationale:** It reuses the existing ARM64 image and preserves EC2, Graviton, IAM instance profiles, ECR, SSM, CloudWatch, and Terraform signal. Stopping it between visits cuts modeled compute from $24.53/month to $1.01 at 30 running hours while the application and PostgreSQL data remain on EBS. Lightsail sacrifices several of those portfolio surfaces and requires a separate x86 image path. **Date/Author:** 2026-07-17 / Codex.
- **Decision:** Keep `infra/` as the standard Terraform root and add an independent `infra/lite/` root. **Rationale:** Moving the live standard resources between modules or states adds risky Terraform address migration without reducing runtime cost. Independent names and state let either profile be created or destroyed without coupling.
- **Decision:** Preserve the shared demo hostname through a Cloudflare Pages Function, with `inbound-origin.dallascrilley.com` for lite and `inbound-standard-origin.dallascrilley.com` for standard proof. **Rationale:** Path routing belongs at the existing demo hub; hostname-level DNS changes are unsafe.
- **Decision:** Use Caddy as the lite origin proxy. **Rationale:** A hostname plus open ports 80/443 gives automatic certificate issuance/renewal and a small reverse-proxy configuration, removing ALB and ACM cost from lite while retaining HTTPS.
- **Decision:** Use hosted inference for live visitors and Ollama only in the standard proof lane. **Rationale:** Ollama accounts for roughly half of the current 8 GB task allocation and creates 1–2 minute scoring latency. The existing provider seam and eval suite preserve independence more credibly through dated execution evidence than idle memory.
- **Decision:** Keep PostgreSQL local to lite and back it up to private versioned S3. **Rationale:** Analytics genuinely requires Postgres, but synthetic portfolio data does not justify always-on RDS. Recovery testing becomes additional portfolio evidence.
- **Decision:** Put a launch/status shell at the shared demo edge and wake lite through an authenticated API Gateway + Lambda control plane. Each valid activation starts only the tagged instance and creates or extends a 60-minute stop lease. **Rationale:** The shell keeps the public URL responsive while compute sleeps; the lease bounds cost without turning the product into a static replay. API Gateway, Lambda, lifecycle IAM, idempotency, and measured cold-start UX add stronger event-driven portfolio evidence than an idle server.
- **Decision:** Do not rewrite the five Nitro apps as Lambda functions or migrate local PostgreSQL to Aurora Serverless v2 in this pass. **Rationale:** Those services can reach a lower theoretical idle floor, but the current product is intentionally consolidated into one long-lived multi-process container. Hibernating that tested boundary captures nearly all compute savings with much less migration risk.
- **Decision:** Default standard proof mode is apply → verify → destroy in one operator session. Interview mode may retain it temporarily only with an explicit keep decision and teardown command. **Rationale:** Default behavior must fail toward low spend.

## Outcomes & Retrospective

U1 established that the portfolio-standard topology is real rather than aspirational: ARM64 ECS, a local Ollama sidecar, private RDS PostgreSQL, ALB health, production seeding, and the complete form-to-route-to-funnel path passed together at Git `126b610`. The recovery also exposed the operational tax the lite profile should remove: a 6.69 GB combined compressed image set, multi-minute task placement/pulls, a scheduler stall at zero tasks, and a modeled roughly $122–125 always-on month for a sparse portfolio workload.

At completion, record the actual fixed idle floor, monthly running hours, wake-to-healthy p50/p95, lease-stop reliability, hosted-model eval results, restore time, standard proof-run cost, cutover downtime, and whether t4g.small passed the post-cutover rightsizing gate.

## Context and Orientation

The application already has the right consolidation boundary. `Dockerfile` builds all five apps, and `scripts/prod-start.mjs` starts analytics, dispatch, forms, qualify, and scheduler behind one gateway on port 8080. `scripts/prod-seed.mjs` hydrates the five logical databases, and `scripts/smoke.sh` proves health, three public surfaces, a planted submission, terminal routing, and funnel movement.

The standard AWS root under `infra/` owns two ECR repositories, one 2 vCPU/8 GB ARM64 Fargate task with app and Ollama containers, one private Single-AZ `db.t4g.micro` PostgreSQL 16 instance, one internet-facing ALB across six default subnets, ACM, SSM SecureStrings, and CloudWatch logs. At 2026-07-17 17:10Z, RDS and ALB were active while ECS had no running task and no registered target. The latest service event named a missing `inbound-demo-ollama` image digest.

The live public hostname is outside this repository. `../job-search/demo-lab` is the Cloudflare Pages project attached to `demos.dallascrilley.com`. `../job-search/edge/demo-router/worker.js` maps `dallascrilley.com/demos/*` to that origin. U7 therefore requires an isolated job-search worktree and its own review/deploy gate.

## Plan of Work

First, recover the existing standard stack and capture one incontestable green baseline. This prevents cost optimization from becoming an excuse to retire infrastructure that never passed production smoke. In parallel with no public cutover, prove a funded pinned OpenAI model against the existing eval suite and record its cost/latency/stability.

Next, make the application image profile-neutral: database SSL mode becomes explicit, smoke output stops assuming Ollama, and the app image build/push path becomes reusable. Then add the independent lite Terraform root, Compose runtime, and narrowly scoped wake/lease control plane. Prove a stopped → wake → healthy → smoke → lease-expired → stopped cycle at the origin, with secrets fetched through roles and logs reaching CloudWatch.

After lite is healthy, create and restore the golden-state backup into a fresh database volume. Add the bounded standard proof command and sanitized receipt format while the current standard state is still available for comparison. Only then add the path-scoped Cloudflare launch/status adapter, connect its server-side wake call, cut the public route to lite, observe cold and warm visits, and request approval to destroy standard billable resources.

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

### U4. Build and prove the hibernating lite EC2 profile

- **Goal:** Provision a ≤$10/month-at-30-hours AWS origin that wakes for real visitors, runs the complete live workflow, and stops after a bounded lease.
- **Requirements:** R1, R2, R3, R5, R8, R9, R13.
- **Files:** `infra/lite/main.tf`, `infra/lite/variables.tf`, `infra/lite/outputs.tf`, `infra/lite/network.tf`, `infra/lite/iam.tf`, `infra/lite/ecr.tf`, `infra/lite/ssm.tf`, `infra/lite/compute.tf`, `infra/lite/lifecycle.tf`, `infra/lite/logs.tf`, `infra/lite/wake/handler.mjs`, `infra/lite/wake/handler.test.mjs`, `infra/lite/runtime/compose.yaml`, `infra/lite/runtime/Caddyfile`, `infra/lite/runtime/app-entrypoint.sh`, `infra/lite/runtime/inbound-lite.service`, `infra/lite/user-data.sh.tftpl`, `infra/lite/push-image.sh`, `infra/lite/deploy.sh`.
- **Approach:** Create an independent `inbound-lite` state and resource namespace. Provision one `t4g.medium`, encrypted 30 GB gp3 root volume, Elastic IP, IAM role/instance profile, ECR repository, SSM SecureStrings, CloudWatch log group, security group for 80/443 only, and budget alarm inputs stored in gitignored tfvars. Add authenticated API Gateway status/wake routes and one lifecycle Lambda. Its mutating permissions can start only the tagged lite instance and create or update one named EventBridge Scheduler stop lease; unavoidable `ec2:DescribeInstances` access is read-only and response-filtered. Each schedule invokes the lifecycle Lambda's lease-expiry operation, which performs the U5 pre-stop backup when available and then requests a graceful stop. The API requires a short-lived timestamped HMAC from the server-side Cloudflare function, applies route throttling, treats duplicate signatures and stopped/pending/running transitions idempotently, and extends a 60-minute lease on each valid activation. Require IMDSv2 and SSM Session Manager; do not create a key pair or port-22 rule. User data installs only the runtime prerequisites and checked-in service assets. `deploy.sh` retrieves SecureStrings with `umask 077`, writes one mode-0400 file per secret, logs into ECR, and starts Caddy, app, and PostgreSQL 16 through Compose. PostgreSQL uses its supported password-file input; the app mounts secret files read-only and `app-entrypoint.sh` exports their values inside the container process immediately before executing `scripts/prod-start.mjs`, so values are absent from Compose config and Docker inspect. Caddy proxies the full `/inbound` path to port 8080 and persists ACME state. Docker uses the `awslogs` driver. Set non-secret `DATABASE_SSLMODE=disable`, `QUALIFY_LLM_PROVIDER=openai`, and the pinned snapshot only in lite.
- **Tests:** Write lifecycle-handler tests first for invalid/expired signatures, duplicate signatures, wrong instance tag, stopped/pending/running states, status response minimization, concurrent activations, lease renewal, lease-expiry stop, AWS API failure redaction, and throttle responses. Terraform policy assertions cover instance type, encryption, IMDSv2, scoped lifecycle IAM, no SSH ingress, no public Postgres/app port, and private S3/log resources. Compose config must resolve with placeholder env names only. Reboot the instance and verify automatic recovery. Stop the app container and verify systemd/Compose restarts it. Confirm no secret or AWS resource identifier appears in user data, Terraform plan text, public API responses, Docker inspect output, or CloudWatch logs.
- **Verification:** `terraform -chdir=infra/lite fmt -check`, `terraform -chdir=infra/lite init`, `terraform -chdir=infra/lite validate`, wake-handler unit tests, `docker compose -f infra/lite/runtime/compose.yaml config`, direct-origin `curl` checks, and `./scripts/smoke.sh https://inbound-origin.dallascrilley.com/inbound`. From a stopped instance, require authenticated wake to reach all-five-app health within 180 seconds, pass full smoke, preserve a fixed state marker across stop/start, renew the lease on a second activation, and return to `stopped` within five minutes after the final lease expires. The first Terraform plan must contain only intended resources; the post-apply run must return 0. Record actual EC2/EBS/IPv4/API Gateway/Lambda/Scheduler/ECR/S3/CloudWatch rate-card inputs. U4a may downsize to `t4g.small` only after cold-wake smoke shows zero OOM/restarts and p95 host memory below 1.5 GB; otherwise `t4g.medium` remains final.

### U5. Make synthetic state portable and recovery-tested

- **Goal:** Meet the 24-hour RPO and 15-minute restore target without always-on RDS.
- **Requirements:** R7, R8, R11.
- **Files:** `infra/lite/backup.tf`, `infra/lite/runtime/inbound-backup.service`, `infra/lite/runtime/inbound-backup.timer`, `scripts/backup-golden-state.sh`, `scripts/restore-golden-state.sh`, `scripts/verify-golden-state.mjs`, `docs/receipts/golden-state-recovery.md`.
- **Approach:** Create a private, versioned, encrypted S3 bucket with public access blocked and a 30-day noncurrent-version lifecycle. A daily systemd timer and the graceful lease-stop path export all five databases in custom format, write a manifest containing schema/app Git SHA, image digest, database list, row-count checksums, eval model/prompt hash, and UTC time, then upload without logging credentials or data. Restore creates fresh databases, applies the existing app migrations/seeds where required, imports the dumps, and runs fixed integrity queries. A failed pre-stop backup emits an alarm and preserves the last known-good object; synthetic-state policy may still stop the instance to keep the cost bound, but the failure must be visible in the next launch shell.
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
- **Approach:** In a separate job-search worktree, add a Pages Function that matches only `/inbound*`. It calls the authenticated lifecycle status route server-side and returns only a minimal same-origin state. When origin status is stopped, pending, or unhealthy, GET requests receive an always-available launch/status shell; its same-origin activation POST is rate-limited and the server-side function signs a short-lived timestamped wake request using an environment secret that never reaches the browser. The shell polls bounded same-origin status until healthy, shows a plain-language cold-start estimate and lease time, and then navigates to the live route. When awake, the function streams method/query/body to the configured `INBOUND_ORIGIN`, strips visitor authorization/cookies and origin-only headers, disables caching for dynamic responses, and preserves status/location/content type. Add `inbound` to the existing flagship/root-path mapping so `dallascrilley.com/demos/inbound` maps to the same Pages path. Configure origin and lifecycle endpoint values in the Pages environment; do not hardcode them in source. Prove the lite origin directly, then deploy the edge change after explicit approval because it mutates a public external surface. Observe cold and warm behavior at both public URLs and run the planted-lead workflow. Keep the green standard profile available for one rollback window of at most 24 hours. After the window, obtain explicit approval, create/verify the final golden-state backup, run the standard receipt capture, and destroy standard resources.
- **Tests:** The Pages Function test covers sleeping status, valid activation, throttled/failed activation, bounded polling, GET/POST proxying, query/body streaming, `/inbound` and nested paths, upstream redirect/status propagation, header stripping, secret non-disclosure, and non-Inbound isolation. Existing demo-router tests must remain green, including all prior flagship routes. Browser and curl checks cover a cold wake, warm visit, `demos.dallascrilley.com/inbound`, `dallascrilley.com/demos/inbound`, at least two unrelated demos, status polling, booking, funnel movement, and lease expiry.
- **Verification:** In job-search, run `pnpm --dir demo-lab test`, `pnpm --dir demo-lab build`, `node --test edge/demo-router/worker.test.js`, and Wrangler dry-runs. After approved deploy, require both Inbound URLs to pass smoke and unrelated demo spot-checks to retain their existing status/headers. Rollback changes only `INBOUND_ORIGIN` back to the still-running standard origin; after standard destruction, rollback restores the latest lite backup onto a replacement lite instance.

### U8. Publish the portfolio and FinOps case study

- **Goal:** Convert the architecture correction into clear, honest senior-level portfolio evidence.
- **Requirements:** R3, R4, R10, R12.
- **Files:** `README.md`, `docs/architecture.md`, `docs/receipts.md`, `docs/cost-case-study.md`, `docs/receipts/aws-standard/latest.json`, `docs/receipts/aws-lite-cost.md`, and the Inbound card/content in `../job-search/demo-lab`.
- **Approach:** Replace the single architecture diagram with hibernating-live-lite and proof-standard diagrams. Publish the original estimate, corrected rate-card estimate, always-on-lite counterfactual, fixed idle floor, running-hour formula, actual first billing observations, and why each service moved or remained. Add a capability matrix labeled live/periodic/local, cold-start and lease evidence, recovery receipt, hosted/offline eval comparison, latest standard proof timestamp, and a two-minute recruiter path. Update wording so “runs fully offline” describes the verified proof lane, not the live scoring lane. Link the case study from the demo hub without exposing secrets, account details, or internal-only endpoints.
- **Tests:** Run every documented command or mark it as an operator-only destructive command. Check every public URL, image, and receipt link. Confirm the README no longer claims ~$55/month or implies Ollama is always live. Verify the public page communicates the tradeoff within one screen and the deeper receipt remains available for technical reviewers.
- **Verification:** `rg -n '\$55|fully offline|ECS Fargate task \(2 vCPU / 8 GB' README.md docs`, `pnpm fmt:check`, link checks, cold/warm public smoke paths, one observed lease stop, and a fresh AWS cost inventory. Acceptance requires a measured core stopped-host floor ≤$6.05/month, full idle base ≤$8, a 30-hour lite projection ≤$10, total ≤$15 with one standard proof run, and no standard billable resources left after teardown.

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
3. From stopped, lite wakes to all-five-app health within 180 seconds, passes the complete planted-lead smoke at the direct origin and both edge URLs, preserves PostgreSQL state, and stops within five minutes of final lease expiry.
4. Hosted inference passes the three-run accuracy/stability/latency/cost gate.
5. A fresh golden-state restore completes under 15 minutes and then passes smoke.
6. A standard proof run passes smoke and offline eval, produces a sanitized receipt, and ends with verified teardown.
7. AWS inventory shows only lite's intended stopped EC2/EBS/EIP, API Gateway/Lambda/Scheduler, ECR/SSM/S3/CloudWatch resources; standard ECS/RDS/ALB resources are absent after approval and teardown.
8. The core stopped-host floor is ≤$6.05/month, full idle base is ≤$8, the 30-running-hour projection is ≤$10, and the one-proof-run monthly total is ≤$15 before model calls.
9. Unrelated demos still work after the edge change.
10. README/docs accurately label every surface and link to the latest receipts.

## Idempotence and Recovery

Terraform applies, image pushes, seeds, wake calls, lease renewals, backup uploads, and receipt capture must be repeatable. Lite deployment uses immutable image digests in Compose after the first successful push; `latest` may exist for operator convenience but is not the deployed identity. Wake against pending/running state returns current status instead of launching duplicate work. Lease renewal updates one named stop schedule rather than accumulating schedules. Seed operations remain idempotent by their existing keys.

If U1 cannot make standard green, do not destroy it or claim proof; record the exact service event/log and continue only with non-destructive lite construction. If U2 lacks funded hosted credentials, build and validate lite infrastructure but do not route public submissions to it. If lite deployment fails, the shared demo route remains unchanged. If edge cutover fails during the rollback window, restore `INBOUND_ORIGIN` to the standard origin and redeploy the Pages project. After standard teardown, recovery is replacement lite infrastructure plus the latest verified golden-state package.

Before destructive standard teardown, save the sanitized receipt, verify the golden-state object and manifest, confirm lite smoke twice at least 15 minutes apart, inspect the exact Terraform destroy plan, and obtain explicit user approval. Never use `-target`, force-unlock without ownership proof, or manual AWS deletion as the normal path.

## Interfaces and Dependencies

- `DATABASE_URL_BASE`: base connection without database name; runtime appends `inbound_` followed by the app id.
- `DATABASE_SSLMODE`: `require` by default; lite explicitly sets `disable`.
- `QUALIFY_LLM_PROVIDER`: `openai` in lite, `ollama` in standard/offline proof.
- `QUALIFY_LLM_MODEL`: pinned hosted snapshot in lite, `qwen3:4b` in standard.
- `WORKSPACE_PUBLIC_PREFIX`: remains `/inbound` in both profiles.
- `INBOUND_ORIGIN`: Cloudflare Pages environment value selecting the current AWS origin; never committed.
- `INBOUND_LIFECYCLE_URL`: Cloudflare Pages server environment value for the API Gateway status/wake routes; never sent to the browser.
- `INBOUND_WAKE_HMAC_SECRET`: matching Cloudflare/AWS secret used only for timestamped server-to-server activation signatures; never committed or exposed to clients.
- Lite lease: one named 60-minute EventBridge Scheduler stop action, renewed idempotently by valid activation.
- `scripts/smoke.sh "$BASE_URL"`: single outcome contract for local, lite, and standard.
- `scripts/backup-golden-state.sh` / `scripts/restore-golden-state.sh`: S3 package contract with a validated manifest.
- Caddy 2: terminates origin HTTPS and proxies `/inbound*` to app port 8080.
- PostgreSQL 16: five logical databases in one lite container or one standard RDS instance.
- AWS Systems Manager Session Manager: only interactive host access; no SSH key pair or port 22.

## Artifacts and Notes

- Origin ideation: `docs/ideation/2026-07-17-inbound-portfolio-value-lite-architecture.md`
- AWS EC2 stop/start persistence and billing: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html>
- AWS RDS seven-day stop limit: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html>
- AWS Aurora Serverless v2 zero-ACU auto-pause alternative: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
- Existing architecture: `docs/architecture.md`
- Existing composition/deploy evidence: `docs/receipts.md`
- Standard baseline receipt: `docs/receipts/aws-standard-baseline.md`
- Hosted model receipt: `docs/receipts/hosted-inference.md`
- Recovery receipt: `docs/receipts/golden-state-recovery.md`
- Latest standard proof receipt: `docs/receipts/aws-standard/latest.json`
- Cost case study: `docs/cost-case-study.md`

## Deferred / Out of Scope

- Static replay as a substitute for the live workflow.
- Rewriting the application runtime onto Lambda, Aurora Serverless, App Runner, Kubernetes, or a multi-host HA lite topology. The narrowly scoped wake Lambda is in scope.
- Automatic scheduled standard proof runs; manual proof is deliberate until cost and cleanup behavior are proven.
- Slack approval sandbox wiring.
- t4g.small as the initial live size; it is evidence-gated U4a only.
- Changing the shared demo hostname's Cloudflare Pages ownership.

## Open Questions

No architecture question remains blocking. Execution still has three operator gates with predetermined fallback behavior: obtain a funded hosted-model credential or stop before cutover; create the two origin DNS records manually if the Cloudflare token remains insufficient; and approve the public edge deployment plus later standard teardown at the moment each external/destructive action is ready. Wake-controller construction and direct-origin proof do not require those public/destructive approvals.

## Revision History

- 2026-07-17: Initial full plan synthesized from the six ranked ideation survivors, live AWS state, repository deployment receipts, relevant solution notes, current AWS/OpenAI pricing, and shared demo-routing ownership.
- 2026-07-17: Pivoted lite from always-on to visitor-activated hibernation; updated `td-f93367`, cost targets, wake/lease security contract, cold-start acceptance, edge shell, recovery flow, and FinOps evidence.
- 2026-07-17: Completed U1 standard recovery at Git `126b610`; added the dated baseline receipt, replaced the stale missing-digest diagnosis with observed root causes, and recorded the ECS scheduler stall plus green planted-lead smoke.
- 2026-07-17: Ran the U2 credential/probe gate, recorded the quota blocker, and hardened hosted-provider error redaction plus request timeout before any live eval.
- 2026-07-17: Implemented the U3 database/image portability contract, including fail-closed immutable deployment, explicit zero-task bootstrap, app-only direct ECR push, provider-neutral smoke messaging, and a live PostgreSQL 16 non-TLS proof.

# Interview Mode

Interview mode is the on-demand way to run the Inbound demo's full AWS stack
(ECS Fargate app + ollama sidecar, RDS PG16, ALB, ECR, SSM) for a single
session — a live interview, a demo call, a portfolio review — without paying
for it to sit idle the rest of the time. One command brings the stack up,
verifies it end-to-end with the planted-lead smoke test, and prints a dated
receipt; one command tears it back down. The stack was applied once
(2026-07-17) and then destroyed specifically because "always on" was costing
~$122-125/mo for something used a handful of times a month — interview mode
is the replacement posture. Everything runs through
[`infra/interview.sh`](../infra/interview.sh); it derives every AWS
identifier (ALB DNS name, subnet ids, security group id, cluster/service
names, image digests) from `terraform output` and live `aws` queries, because
all of those change on every destroy + re-apply cycle.

## Prerequisites

- **AWS credentials** for account `221909913867`, region `us-east-1`, with
  permission to manage ECS, RDS, ALB/EC2, ECR, SSM, ACM, and IAM roles.
  `aws sts get-caller-identity` must succeed before `up` will proceed.
- **`infra/terraform.tfvars`** with at least `db_password` set (gitignored;
  see `infra/variables.tf` for the URL-safe character constraint). Without
  it, `terraform apply` will prompt for the password interactively — set it
  in tfvars instead so `up` isn't blocked on a prompt mid-run.
- **Docker / OrbStack** running locally with `docker buildx` available —
  images are built for `linux/arm64` and pushed straight to ECR.
- **Local `ollama serve`, if you run one**: `infra/push-images.sh` (called by
  `up`) `pkill`s any local `ollama serve` process while it builds the sidecar
  image. If you have a dev session using local ollama, expect it to be
  killed — restart it after `up` finishes if you still need it.
- `terraform`, `aws`, `python3`, `git`, and `timeout` (GNU coreutils —
  `brew install coreutils` on macOS) on `PATH`.
- **1Password CLI (`op`), optional but recommended**: with it, `up` reads the
  zone-capable Cloudflare token ("Cloudflare API Token - dallascrilley.com
  (dallasdotjs)") at run time and fully automates DNS + HTTPS (see below).
  Without it, everything still works over the raw ALB URL with manual DNS.

## The three commands

```bash
infra/interview.sh up       # apply → build/push images → roll out → seed → smoke → receipt
infra/interview.sh status   # read-only: terraform outputs + ECS state + one healthz probe
infra/interview.sh down     # terraform destroy (typed confirmation required) → teardown receipt
```

Both `up` and `down` accept `--yes` to skip interactive confirmation (for
scripted use); `up`'s cost warning banner always prints regardless.

### `up`

1. Checks AWS credentials and `terraform.tfvars`, prints the cost banner,
   probes 1Password for the Cloudflare token (sets the DNS posture), and
   confirms interactively (unless `--yes`).
2. `terraform init` + `terraform apply`. With the token: two-phase apply —
   stack + DNS records + ACM validation, then the HTTPS listener — and the
   session runs at `https://demos.dallascrilley.com/inbound`. Without it:
   single apply, HTTP on the raw ALB name (see the DNS section below).
3. Builds and pushes the app image and the ollama sidecar image (baked with
   `qwen3:4b`) via `infra/push-images.sh`, retrying up to 3 times — a
   transient OrbStack buildkit "exporting to image" EOF is common and just
   needs a retry.
4. Forces a fresh ECS deployment (`aws ecs update-service
   --force-new-deployment`).
5. Polls `http://<alb-dns-name>/inbound/healthz` until `{"ok":true}`
   (15 min timeout).
6. Runs the one-off prod-seed ECS task (`node scripts/prod-seed.mjs`),
   waiting for it to stop and checking its exit code.
7. Runs `scripts/smoke.sh` against the ALB URL — plants a lead, polls for a
   terminal status, checks the funnel moved.
8. Prints a dated receipt block (git rev, image digests, ALB URL, smoke
   result) formatted to paste directly into `docs/receipts.md`.

### `down`

Requires typing `destroy inbound-demo` to confirm (or `--yes` for scripted
use), then runs `terraform destroy` and prints a teardown receipt block.
**Run this the moment the session ends.** There is no automatic expiry —
see "Future guard" below.

### `status`

Read-only. Prints terraform outputs, the ECS service's desired/running/
pending counts and deployment rollout state, and a single healthz probe.
Safe to run any time, including while the stack is down (prints "no
terraform outputs available" instead of erroring).

## Expected timings

| Step | Typical time |
|---|---|
| `terraform apply` (from destroyed state) | ~15 min (RDS instance creation dominates) |
| image build + push (app + ollama sidecar) | a few minutes, depends on Docker cache state |
| ECS deployment boot (pull + migrations + ollama model ready) | 5-10 min |
| smoke test (ollama CPU scoring is slow) | up to 15 min |

A full `up` from a cold `terraform destroy`d state can take 30-45 minutes
end to end. `down` (terraform destroy) is typically a few minutes.

## DNS — automated when 1Password is available

The ALB gets a **new DNS name on every `terraform apply` after a
`destroy`**, so `demos.dallascrilley.com` must be repointed each session.
`up` handles this automatically when the 1Password CLI can read the
zone-capable token ("Cloudflare API Token - dallascrilley.com
(dallasdotjs)", verified 2026-07-20 with a live DNS write probe):

- The token is read at run time (`op read`), exported as
  `TF_VAR_cloudflare_api_token`, and never written to disk.
- Any pre-existing `demos.dallascrilley.com` record (a Cloudflare Pages
  CNAME parks there between sessions) is **backed up to
  `infra/.interview-dns-backup.json` and removed** so terraform can own the
  name; `down` restores it after destroy.
- Apply runs in two phases: phase 1 (`manage_dns=true`) creates the stack,
  the ACM validation records, and the demos CNAME, and waits for the cert
  to validate; phase 2 (`cert_validated=true`) attaches the HTTPS listener
  and the HTTP→HTTPS redirect.
- The working URL for the session is then simply
  **`https://demos.dallascrilley.com/inbound`**, and healthz/seed/smoke all
  run against it.

**Manual fallback** (no `op`, token unreadable, or zone not visible): `up`
warns, applies with `manage_dns=false`, and the session runs on the raw ALB
URL over `http` (printed as the "working URL"). An operator can still
repoint the CNAME by hand from `terraform output alb_dns_name` and validate
the cert via `terraform output dns_records_to_create` +
`-var cert_validated=true`. On `down`, if a DNS backup exists but the token
is unavailable, the script warns and keeps the backup file for a manual
restore.

## Capturing the receipt

`up` prints a receipt block ending in `--------`. Copy it into
`docs/receipts.md` (newest entries last, matching the existing `[cmd]` /
`[state]` bullet convention already used there) so every interview-mode
session leaves an auditable trail of what was deployed and whether the smoke
test passed. `down` prints an equivalent teardown block — capture that too.

## Teardown

`infra/interview.sh down`. Confirm AWS console-side if in doubt (ECS
cluster, RDS instance, EC2 > Load Balancers, ECR repositories) — `terraform
destroy` should remove all of them (`force_delete` is set on both ECR repos,
`skip_final_snapshot`/`deletion_protection=false` on RDS), but a manual
sanity check after a costly demo is cheap insurance.

## Future guard (not built here)

The scripts do not enforce any automatic expiry. A natural follow-up would
be a scheduled check (e.g. a cron/Lambda) that pages if the stack has been
up longer than a few hours, or a hard auto-destroy after N hours, so a
forgotten `down` doesn't quietly rack up cost. Out of scope for this
runbook — flagged for a future session.

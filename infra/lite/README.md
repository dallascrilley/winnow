# Inbound Lite

This is the independent, hibernating AWS profile. It creates no dependency on
the standard ECS/RDS stack and does not own public DNS. A Terraform plan is
safe and non-billable; do not apply until the plan-policy tests and security
review pass.

## Local proof (no AWS resources created)

```bash
./infra/lite/local-plan.sh /tmp/inbound-lite-plan.json
INBOUND_LITE_PLAN_JSON=/tmp/inbound-lite-plan.json node --test infra/lite/policy.test.mjs
node --test infra/lite/state-bootstrap/policy.test.mjs
node --test infra/lite/wake/handler.test.mjs
node --test scripts/verify-golden-state.test.mjs
./scripts/golden-state-recovery.test.sh
AWS_REGION=us-east-1 ORIGIN_ADDRESS=inbound-origin.dallascrilley.com \
  PUBLIC_URL=https://inbound-origin.dallascrilley.com \
  APP_IMAGE_REF=example.invalid/inbound@sha256:$(printf '0%.0s' {1..64}) \
  docker compose -f infra/lite/runtime/compose.yaml config --quiet
```

The default `bootstrap_only=true` plan intentionally starts with
`APP_IMAGE_REF=UNSET`; its systemd unit fails closed until `push-image.sh`
publishes an immutable ECR digest. It also fails closed when
`/inbound-lite/OPENAI_API_KEY` is absent. A proof-mode plan must set
`bootstrap_only=false`, supply a funded key and immutable initial image ref, and
pass the Terraform input check. The host always shuts itself down after its
first cloud-init run, including failed bootstraps.

Terraform configures Caddy and the app for
`https://inbound-origin.dallascrilley.com` by default, but this root never
creates or changes DNS. Set `origin_hostname` before apply if that dedicated
origin changes. Provider checksums are committed in `.terraform.lock.hcl`; the
Lambda intentionally uses the AWS SDK included in the pinned Node.js 22 Lambda
runtime to keep the artifact dependency-free. The first live apply must include
an integration smoke because AWS recommends bundling SDK clients when strict
dependency-version control is required.

Docker restart policies handle crashes. A one-minute systemd health timer also
repairs an intentionally stopped app container by restarting the Compose unit;
the live U4 proof must measure that recovery path after apply.

The U5 recovery path stores five custom-format PostgreSQL dumps in the private,
versioned backup bucket. `inbound-backup.timer` runs daily while the host is
awake, and the runtime unit attempts one final backup before Compose stops.
`latest.json` changes only after every archive and row-count checksum is written.
Restore validates the complete package before it can replace the five synthetic
databases, and requires the explicit
`RESTORE_CONFIRM=replace-synthetic-databases` guard. See
`docs/receipts/golden-state-recovery.md`. Never run this path against real
visitor, customer, or private Builder data. Backup also requires the
`synthetic-demo-only` classification and rejects email-like values outside
reserved demo domains across public text/JSON columns.

Generated SSM values are sensitive Terraform state. The active partial S3
backend in `backend.tf` requires encrypted remote state and native lockfiles for
normal operations. Before the approved first apply, follow
`state-bootstrap/README.md` to create the private, versioned, exact-principal
bucket and render the ignored `backend.hcl`. `local-plan.sh` is the only
pre-bootstrap path: it plans from a disposable copy without `backend.tf` and
cannot create resources. State and backend configuration files are ignored,
never committed, and must be destroyed or rotated with the stack.

The budget is created at `$10` by default. Set `budget_notification_email` only
as an explicit operator choice; the blank bootstrap default intentionally sends
no external email.

Applying, pushing an image, changing public DNS, or changing the shared
Cloudflare route are separate operator actions and are not part of local proof.

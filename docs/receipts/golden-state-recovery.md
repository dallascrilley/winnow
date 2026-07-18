# Golden-state recovery receipt

Date: 2026-07-18 09:30Z
Scope: local/no-apply U5 construction
Git: commit containing this receipt
AWS mutation: none

## Result

The lite profile now models a separate private S3 backup bucket and has a
tested five-database backup/restore path. A disposable PostgreSQL 16.9
container produced custom-format archives for Analytics, Dispatch, Forms,
Qualify, and Scheduler. The test rejected a corrupted archive before changing
the target, restored a valid package, verified exact row-count checksums, and
completed in 29 seconds against the synthetic fixture. The acceptance ceiling is
15 minutes.

This receipt does **not** claim a live S3 upload, EC2 shutdown backup, or cloud
restore. Those require the still-gated lite apply. No AWS resource was created.

## Package contract

- Exact allowlist of five `inbound_*` databases.
- PostgreSQL custom-format archives with byte length and SHA-256 per archive.
- Deterministic per-table row-count files with SHA-256.
- Full Git SHA, immutable image digest, latest eval model, prompt hash, and UTC
  creation time.
- Unique immutable `packages/<package-id>/` object prefix; `latest.json` is
  uploaded last as the commit marker.
- Required `synthetic-demo-only` classification plus a database-wide scan of
  public text and JSON columns; email-like values outside reserved `.test`,
  `.invalid`, and `example.com/.org/.net` domains block the package.
- Restore downloads exact keys, validates every file and `pg_restore --list`
  before mutation, and requires
  `RESTORE_CONFIRM=replace-synthetic-databases`.

Only synthetic portfolio state may enter this path. The email scan is a
fail-closed guard, not a general PII classifier; a live recovery proof must also
inspect the source dataset before upload and must not preserve real visitor,
customer, or private Builder data.

## Infrastructure contract

The backup bucket uses SSE-S3, versioning, Block Public Access, Bucket Owner
Enforced ownership, TLS-only access, and 30-day noncurrent-version expiration.
The instance role can get, put, or abort multipart uploads only below the
`golden-state/` object prefix; it cannot list all buckets or delete backups.
One encrypted private runtime bundle avoids the EC2 16 KB user-data ceiling and
is readable only at its exact object key; noncurrent runtime versions also
expire after 30 days.
Systemd runs a daily persistent timer and attempts a final backup before the
Compose runtime stops. A failed final backup does not defeat the bounded
instance shutdown policy; the previous `latest.json` remains unchanged.

PostgreSQL documents custom archives as portable across architectures and
restorable with `pg_restore`: <https://www.postgresql.org/docs/current/app-pgdump.html>.
AWS S3 security guidance: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html>.

## Fresh proof commands

```bash
node --test scripts/verify-golden-state.test.mjs
./scripts/golden-state-recovery.test.sh
./infra/lite/local-plan.sh /tmp/inbound-lite-plan.json
INBOUND_LITE_PLAN_JSON=/tmp/inbound-lite-plan.json node --test infra/lite/policy.test.mjs
terraform -chdir=infra/lite fmt -check
terraform -chdir=infra/lite validate
shellcheck scripts/backup-golden-state.sh scripts/restore-golden-state.sh scripts/golden-state-recovery.test.sh
```

## Live proof still required

After explicit cost approval and the other lite gates close: upload one
synthetic package through the instance role, stop the host, replace or reset a
fresh PostgreSQL target, restore from `latest.json`, run the full planted-lead
smoke, confirm the timer/final-stop logs, and record the measured cloud restore
time here.

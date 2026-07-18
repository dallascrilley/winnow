# Inbound AWS profiles

`infra/` is the temporary managed-service proof profile. `infra/lite/` is the
hibernating live profile. They have separate Terraform roots and must never be
applied or destroyed through the same command.

## Standard proof mode

Inspect the complete apply, immutable-image, seed/eval, smoke, and teardown
sequence without contacting AWS:

```bash
./infra/proof-standard.sh --dry-run
```

The live command is deliberately double-gated because it creates billable
ECS, RDS, ALB, ECR, SSM, and CloudWatch resources. It is an operator-only
command and has not been run by the local construction slice:

```bash
PROOF_CONFIRM=apply-standard-and-destroy \
  ./infra/proof-standard.sh --execute
```

Execution requires a clean Git worktree. It validates Terraform, bootstraps
ECR with ECS at zero, pushes both ARM64 images, deploys immutable digests, runs
the production seed and a fresh `qwen3:4b` eval in a one-off task, runs the
planted-lead smoke, checks for drift, and destroys the standard root. Failures
after the first apply enter the same teardown path. The verified receipt is
written only after Terraform state and direct AWS namespace checks all return
zero and the before/after lite resource fingerprint is unchanged.
The receipt uses a conservative $0.20 per running-hour estimate, keeping a
24-hour proof under its $5 ceiling while buffering the current compute rate for
small storage and request charges.

For a deliberate interview window, add `--keep-for-interview` and the second
confirmation. A successful proof may remain up for at most 24 hours; a failed
proof is still destroyed automatically. This mode prints the UTC deadline and
exact cleanup command and does not update the durable receipt until teardown
is verified.

```bash
PROOF_CONFIRM=apply-standard-and-destroy \
KEEP_STANDARD_CONFIRM=retain-standard-for-at-most-24-hours \
  ./infra/proof-standard.sh --execute --keep-for-interview
```

The script never invokes `infra/lite` and compares the tagged lite resource
fingerprint before and after the standard proof. It does not manage Cloudflare
or public DNS.

## Local proof

```bash
bash -n infra/proof-standard.sh
shellcheck infra/proof-standard.sh
node --test infra/proof-standard.test.mjs \
  scripts/capture-standard-receipt.test.mjs \
  scripts/prod-proof.test.mjs
./infra/proof-standard.sh --dry-run
```

See `docs/receipts/aws-standard/README.md` for the receipt boundary and the
latest verified proof status.

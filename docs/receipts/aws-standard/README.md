# Standard proof receipts

`latest.json` is the sanitized, machine-readable receipt for the most recent
successful standard proof run whose teardown was independently verified by the
operator workflow.

No `latest.json` is present yet. The earlier managed-service deployment and
cost-first teardown are documented in `../aws-standard-baseline.md` and
`../aws-standard-teardown.md`; they predate the automated receipt contract.
The local/no-AWS construction of the automation does not fabricate a live
receipt.

The receipt can contain only:

- full Git SHA, region, Terraform version, UTC observation time, duration, and
  estimated run cost;
- fixed safe topology descriptions and ECS task-definition revision;
- application and Ollama content digests without ECR repository/account data;
- planted-lead smoke status and aggregate `qwen3:4b` accuracy;
- verified teardown status and zero-count residual inventory for Terraform,
  ECS, RDS instances/snapshots, ALB, ACM, ECR, CloudWatch Logs, and SSM.

The validator rejects mutable image references, offline accuracy below 90%, a
run longer than 24 hours, an estimate above $5, nonzero residual resources,
unverified teardown, or unexpected fields such as raw Terraform state. It does
not persist account IDs, ARNs, endpoints, credentials, case-level eval data,
logs, or private infrastructure details.

`--keep-for-interview` never updates `latest.json`; the durable receipt is
written only after the retained stack is destroyed and the zero-residual audit
passes.

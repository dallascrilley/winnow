# AWS Standard Teardown Receipt

This receipt records the cost-first removal of the temporary standard Inbound
proof stack after its immutable deployment, production seed, health, and
planted-lead smoke checks passed.

## Identity

- Observed: `2026-07-17T22:38:17Z`
- Git revision containing the final proof receipt: `3655be4`
- Region: `us-east-1`
- Terraform root: `infra/`
- Reason: stop ongoing AWS charges before building the hibernating lite profile

## Actions

1. Set the ECS service desired count to zero.
2. Requested an immediate RDS stop to halt compute while the destroy plan was
   reviewed.
3. Generated and reviewed a Terraform destroy plan containing only 34
   `inbound-demo` resources.
4. Applied the saved plan. Terraform returned exit 0 with `34 destroyed`.

The destroy removed the ALB, RDS instance, ECS service and cluster, task
definition revision managed by Terraform, ECR repositories and images,
CloudWatch log group, SSM parameters, IAM roles and policies, ACM certificate,
security groups, and supporting rules. Terraform did not manage or change a
Cloudflare zone or DNS record.

## Residual-cost audit

| Check | Result |
| --- | --- |
| Terraform state resources | 0 |
| RDS instances named `inbound-demo` | 0 |
| RDS snapshots for `inbound-demo` | 0 |
| Load balancers named `inbound-demo` | 0 |
| ECR repositories `inbound-demo` / `inbound-demo-ollama` | 0 |
| Elastic IPs tagged for Inbound | 0 |
| CloudWatch log groups under `/ecs/inbound-demo` | 0 |
| SSM parameters under `/inbound-demo` | 0 |

AWS's Resource Groups Tagging API still returns five ECS records. Direct ECS
inspection confirms they are non-running metadata only: the cluster and service
are `INACTIVE`, desired/running/pending counts are zero, active service count is
zero, and task-definition revisions 1 through 3 are `INACTIVE`. ECS control
plane metadata does not incur Fargate compute charges.

## Deliberate consequences

- The standard public origin is offline until a proof run reapplies it.
- The RDS contents, ECR images, and CloudWatch logs were deleted. The data was
  synthetic and was already proven reproducible by the checked-in image build,
  production seed, and smoke path.
- Cost Explorer and invoices lag resource state, so this receipt proves current
  resource absence, not that same-day usage has already appeared in billing.
- No lite resources have been applied yet. Current Inbound AWS runtime cost from
  this standard stack is therefore zero after AWS finishes normal metering lag.


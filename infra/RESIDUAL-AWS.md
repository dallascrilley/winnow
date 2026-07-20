# Residual AWS: `inbound-lite` (not interview mode)

**Account:** `221909913867` · **Region:** `us-east-1`  
**Inventory date:** 2026-07-20 (live `aws` + remote tfstate read)  
**Do not confuse with interview mode.** The on-demand full stack uses the
prefix **`inbound-demo`** (`infra/*.tf`, `infra/interview.sh`). That stack is
currently **down** (empty local tfstate, no ECS/RDS/ALB). Everything below is
the separate **lite** experiment from 2026-07-18 (Graviton EC2 origin + wake
Lambda), left behind after the portfolio cost pivot to interview mode.

This document is inventory + teardown notes only. It does **not** destroy
anything. Prefer `terraform destroy` against the lite state when the lite
source tree is available; use the manual order only as a last resort.

## Why it still exists

Ideation (`docs/ideation/2026-07-17-inbound-portfolio-value-lite-architecture.md`)
explored a cheaper always-on lite profile. A lite stack was applied once
(2026-07-18), then work moved to **interview mode** for the full
ECS/RDS/ALB proof. The lite resources were never torn down. Interview mode
scripts intentionally do **not** touch `inbound-lite*` names.

## Idle cost signal (approx.)

These are order-of-magnitude static leftovers, not a Cost Explorer receipt:

| Item | State | Why it still bills |
|---|---|---|
| Elastic IP `32.197.109.250` (`eipalloc-052ffc0df15c0a60c`) | Associated to **stopped** EC2 | Public IPv4 charge while allocated (~$3.6/mo) — **largest clear idle leak** |
| EBS for `i-0240b508562452100` | Stopped `t4g.medium` | Root volume storage while instance stopped |
| ECR `inbound-lite` | 3 images, ~2.75 GiB logical | Storage |
| S3 tfstate + golden buckets | Small objects | Storage (negligible) |
| DynamoDB `inbound-lite-control` | Exists | On-demand table idle ≈ $0 |
| Lambda + HTTP API | Idle | Free tier / near-zero without traffic |
| CloudWatch log groups | ~112 KiB stored | Negligible |
| SSM SecureString params | 8 parameters | Negligible |
| AWS Budgets `inbound-lite-monthly` | Exists | Free |

**Highest-value single action if tearing down:** release the EIP (or full
destroy) so the stopped instance stops holding a billable public IPv4.

## Live inventory (verified 2026-07-20)

### Compute / network

| Resource | ID / name | Notes |
|---|---|---|
| EC2 instance | `i-0240b508562452100` (`inbound-lite`) | **stopped** · `t4g.medium` · launched 2026-07-18 |
| Elastic IP | `eipalloc-052ffc0df15c0a60c` → `32.197.109.250` | Associated to the stopped instance; tags `project=inbound-lite` |
| ENI | `eni-04904d21cd9c449da` | in-use on the instance |
| Security group | `sg-0a1bde5f93a58896c` | `inbound-lite-*` · VPC `vpc-9355aeee` · 80/443 ingress |

### Wake path

| Resource | ID / name | Notes |
|---|---|---|
| Lambda | `inbound-lite-wake` | `nodejs22.x` · 128 MB · last modified 2026-07-18 |
| API Gateway HTTP API | `vbvq3trcef` (`inbound-lite-wake`) | `https://vbvq3trcef.execute-api.us-east-1.amazonaws.com` |
| Routes | `POST /wake`, `GET /status` | Integration → Lambda |
| Scheduler group | `inbound-lite` | Group present (no active schedules listed at inventory time) |

### Data / registry / config

| Resource | Name | Notes |
|---|---|---|
| ECR | `inbound-lite` | URI `221909913867.dkr.ecr.us-east-1.amazonaws.com/inbound-lite` · tag `3cf35b6fd89f` + untagged layers |
| DynamoDB | `inbound-lite-control` | Control plane table from lite design |
| S3 | `inbound-lite-tfstate-221909913867-us-east-1` | Object: `lite/terraform.tfstate` (serial **4**, TF **1.15.6**, lineage `81bc54f7-d755-9208-5d9b-20aabf34bd96`) |
| S3 | `inbound-lite-golden-state-221909913867` | Object: `runtime/runtime-bundle.zip` |
| SSM | `/inbound-lite/*` | `A2A_SECRET`, `ANALYTICS_PUBLIC_KEY`, `APP_GIT_SHA`, `APP_IMAGE_REF`, `BETTER_AUTH_SECRET`, `DATABASE_PASSWORD`, `OPENAI_API_KEY`, `WAKE_SECRET` |
| Log groups | `/inbound-lite/runtime`, `/inbound-lite/wake-api`, `/aws/lambda/inbound-lite-wake` | ~112 KiB total at inventory |
| Budget | `inbound-lite-monthly` | Account budget |

### IAM

| Role | Purpose (from naming / attachments) |
|---|---|
| `inbound-lite-origin-20260718163245582100000002` | EC2 origin · `AmazonSSMManagedInstanceCore` + inline runtime |
| `inbound-lite-scheduler-20260718163245567500000001` | Scheduler invoke |
| `inbound-lite-wake-20260718163246049300000003` | Wake Lambda control |
| Instance profile | `inbound-lite-20260718163246762600000005` | Attached to origin role |

### Explicitly **not** present (good)

- No `inbound-demo` / interview ECS cluster, RDS instance, or ALB
- No Secrets Manager secrets named `inbound*`
- No CloudFormation stacks named `inbound*`
- No ACM certs dedicated to inbound hostnames in this skim

## Remote Terraform state (source of truth for destroy)

```text
s3://inbound-lite-tfstate-221909913867-us-east-1/lite/terraform.tfstate
serial=4  terraform=1.15.6  lineage=81bc54f7-d755-9208-5d9b-20aabf34bd96
```

Managed resource types in that state (non-data): API Gateway v2 API +
routes/stage/integration, Budgets, 3 log groups, DynamoDB control table,
ECR repo + lifecycle, EIP + association, 3 IAM roles + policies + instance
profile + SSM core attachment, EC2 instance, Lambda + permission, S3 backup
bucket (+ encryption/versioning/lifecycle/public-access/policy) + runtime
object, Scheduler schedule group, security group, 8 SSM parameters, 5
`random_password` values.

The lite **`.tf` source is not in this repo** (`infra/` here is interview /
`inbound-demo` only). If the lite root module still exists on another machine
or branch, destroy from there with the S3 backend pointed at the bucket
above. Do not `terraform destroy` inside this repo’s `infra/` expecting to
clean lite — wrong state, wrong resources.

## Teardown notes (operator-approved only)

### Preferred: Terraform destroy from the lite root

1. Locate the original lite Terraform root (not this repo’s `infra/`).
2. Backend must resolve to  
   `s3://inbound-lite-tfstate-221909913867-us-east-1` key `lite/terraform.tfstate`.
3. `terraform init` → `terraform plan -destroy` → review → `terraform destroy`.
4. Confirm with the verification commands below.
5. Optionally delete the **tfstate bucket itself** only after the state object
   shows no managed resources (or after a final state rm you accept).

### Manual fallback order (if lite source is gone)

Destroy dependents before principals. **Do not** run this casually; EIP/EC2
deletes are irreversible without snapshots.

1. **API / Lambda wake path**
   - Delete HTTP API `vbvq3trcef` (routes/integrations go with it), or
     remove routes then API.
   - Delete Lambda `inbound-lite-wake`.
   - Delete log groups `/aws/lambda/inbound-lite-wake`, `/inbound-lite/wake-api`.
2. **Scheduler**
   - Delete any schedules inside group `inbound-lite`, then delete group
     `inbound-lite`.
3. **Compute / IP (stops the main idle bill)**
   - Disassociate + release EIP `eipalloc-052ffc0df15c0a60c`.
   - Terminate EC2 `i-0240b508562452100` (or keep stopped only if you still
     need the EBS volume — otherwise terminate).
   - Delete SG `sg-0a1bde5f93a58896c` after ENI/instance are gone.
4. **Data plane**
   - Empty + delete DynamoDB `inbound-lite-control`.
   - Delete ECR images then repository `inbound-lite`.
   - Empty + delete S3 `inbound-lite-golden-state-221909913867`
     (including `runtime/runtime-bundle.zip`).
   - Delete log group `/inbound-lite/runtime`.
5. **Config / IAM**
   - Delete SSM parameters under `/inbound-lite/` (all 8).
   - Detach policies → delete instance profile → delete the three
     `inbound-lite-*` roles.
6. **Budget**
   - Delete budget `inbound-lite-monthly`.
7. **State bucket last**
   - After AWS is clean: delete object `lite/terraform.tfstate`, then bucket
     `inbound-lite-tfstate-221909913867-us-east-1` if unused.

### Verification after teardown

```bash
aws ec2 describe-instances --region us-east-1 \
  --filters Name=tag:Name,Values='*inbound-lite*' \
  --query 'Reservations[].Instances[].{id:InstanceId,state:State.Name}'
aws ec2 describe-addresses --region us-east-1 \
  --filters Name=tag:project,Values=inbound-lite
aws ecr describe-repositories --region us-east-1 \
  --repository-names inbound-lite 2>&1 | head
aws ssm describe-parameters --region us-east-1 \
  --parameter-filters Key=Name,Option=BeginsWith,Values=/inbound-lite \
  --query 'Parameters[].Name'
aws lambda get-function --region us-east-1 --function-name inbound-lite-wake 2>&1 | head
aws apigatewayv2 get-apis --region us-east-1 \
  --query 'Items[?Name==`inbound-lite-wake`]'
aws dynamodb describe-table --region us-east-1 --table-name inbound-lite-control 2>&1 | head
aws s3 ls s3://inbound-lite-golden-state-221909913867 2>&1 | head
aws s3 ls s3://inbound-lite-tfstate-221909913867-us-east-1 2>&1 | head
aws iam list-roles --query 'Roles[?contains(RoleName, `inbound-lite`)].RoleName'
```

Expect: not-found / empty for each.

## Relationship to this repo

| Stack | Prefix / names | Managed here? | Status 2026-07-20 |
|---|---|---|---|
| Interview / full demo | `inbound-demo` | Yes — `infra/*.tf` + `interview.sh` | Down; activate only via `interview.sh up` (billable) |
| Lite experiment | `inbound-lite*` | **No** source in this repo | Residual resources above still in account |

Interview helpers (`status`, `purge-ghost`, `check-expiry`, launchd notifier)
scope themselves to **inbound-demo** / local interview session markers. They
will **not** page or destroy lite leftovers. Track lite cleanup as an
explicit operator task using this file.

## Refresh inventory

```bash
# cheap re-check (read-only)
aws ec2 describe-instances --region us-east-1 \
  --filters Name=tag:Name,Values=inbound-lite \
  --query 'Reservations[].Instances[].State.Name' --output text
aws ec2 describe-addresses --region us-east-1 \
  --allocation-ids eipalloc-052ffc0df15c0a60c \
  --query 'Addresses[0].PublicIp' --output text
aws s3 ls s3://inbound-lite-tfstate-221909913867-us-east-1/lite/
```

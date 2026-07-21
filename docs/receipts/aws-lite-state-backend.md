# AWS Lite State Backend Receipt

This receipt records the approved creation of the minimal persistent AWS
surface needed to protect credential-bearing Terraform state before any
Inbound lite runtime apply.

## Identity and authorization

- Observed: `2026-07-18T13:18:58Z`
- Region: `us-east-1`
- Terraform roots: `infra/lite/state-bootstrap` and `infra/lite`
- td task: `td-2ad88f`
- Authorization: create the encrypted, versioned S3 state backend only
- Excluded: lite runtime apply, standard proof run, hosted inference, DNS, and
  Cloudflare changes

Account, bucket, and IAM principal identifiers are intentionally omitted. The
bootstrap derives the deterministic bucket name from the authenticated account
and pins its policy to the stable IAM user or role behind the active session.

## Applied surface

Terraform applied the saved bootstrap plan with `7 added, 0 changed, 0
destroyed`. The persistent surface is one S3 bucket and its six controls:

1. Bucket Owner Enforced ownership.
2. All four Block Public Access settings.
3. SSE-S3 encryption using `AES256`.
4. Versioning.
5. A 90-day noncurrent-version recovery window.
6. A policy requiring TLS and denying every principal except the exact operator
   IAM user or role.

The bucket uses native S3 lockfiles, so this gate adds no DynamoDB table or
customer-managed KMS key. The bootstrap bucket has `force_destroy = false`.

## Verification

| Check                       | Result                                             |
| --------------------------- | -------------------------------------------------- |
| Post-apply bootstrap plan   | 0 changes                                          |
| Live encryption             | `AES256`                                           |
| Live versioning             | Enabled                                            |
| Live ownership              | Bucket Owner Enforced                              |
| Live public access          | All four controls enabled; policy nonpublic        |
| Live recovery window        | 90 noncurrent days                                 |
| Live policy                 | TLS required; exact stable IAM operator only       |
| Generated backend config    | Git-ignored, mode `0600`                           |
| Lite backend initialization | S3 backend initialized successfully                |
| Native S3 locking           | Versioned lock object and delete marker observed   |
| Remote lite state           | Empty; no runtime state object exists before apply |
| Remote-backed lite plan     | 47 create, 0 update, 0 delete                      |
| Tracked state/config scan   | No `backend.hcl` or Terraform state tracked        |

No lite runtime resource was applied. The only new persistent cost surface is
the private S3 bucket's small request and storage usage; there is no always-on
compute, database, load balancer, public IPv4 address, or paid locking/KMS
resource from this operation.

## Rotation and retirement

Credential rotation and backend destruction remain governed by
`infra/lite/state-bootstrap/README.md`: verify new credentials before removing
superseded state versions; destroy the lite stack first; preserve a final state
copy only when required; and treat emptying versioned objects as an explicit
destructive action before destroying the bootstrap root.

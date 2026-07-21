# AWS Lite Live Proof Receipt

This receipt records the first bounded live proof of the hibernating Inbound
lite architecture. Identifiers for the AWS account, instance, bucket, API, IP
address, and IAM resources are intentionally omitted.

## Scope

- Observed: `2026-07-18T17:13:53Z`
- Region: `us-east-1`
- Terraform root: `infra/lite`
- td task: `td-f93367`
- Authorized: apply lite, publish one immutable app image, prove internal
  lifecycle/health/persistence/repair, and stop immediately
- Excluded: DNS or Cloudflare mutation, public edge cutover, standard-stack
  proof, and indefinite runtime

## Applied surface

The saved remote-state-backed plan applied `48 added, 0 changed, 0 destroyed`.
It created the intended hibernating profile: one stopped ARM64 EC2 host with an
encrypted 30 GB gp3 volume and Elastic IP, plus the bounded ECR, SSM, S3,
CloudWatch, API Gateway, Lambda, DynamoDB, Scheduler, IAM, and budget controls.

The production image was built once for all five apps and pushed by immutable
digest. The SSM image pointer contains an ECR digest reference, and its source
pointer matches the Git revision used for the build.

## Live proof

| Check                 | Result                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| First bootstrap       | Host stopped after bootstrap as designed                                                           |
| Authenticated wake    | `202`; state `starting`; renewable lease returned                                                  |
| Replay protection     | Reusing a signed nonce returned `409 replayed_request`                                             |
| Runtime               | Caddy, app, and PostgreSQL containers running; PostgreSQL healthy                                  |
| Five-app health       | Analytics, Dispatch, Forms, Qualify, and Scheduler all `up: true`                                  |
| Container repair      | Stopped app container was repaired by the one-minute systemd timer and returned to five-app health |
| Stop/wake persistence | PostgreSQL marker survived an EC2 stop and authenticated wake                                      |
| Final host state      | `stopped`                                                                                          |
| Final Terraform plan  | No changes                                                                                         |

The proof exposed and fixed three bootstrap defects before the green cycle:

1. Amazon Linux 2023 already provides AWS CLI and `curl-minimal`; asking DNF
   for `awscli2` aborted the bootstrap, and asking for full `curl` conflicted
   with `curl-minimal`.
2. Redirecting `aws ssm get-parameter --output text` directly to secret files
   retained a trailing newline. PostgreSQL strips that newline from its
   password-file input while the app encoded it into `DATABASE_URL`, producing
   mismatched credentials. Runtime secret files now use `printf '%s'`.
3. Refresh after Elastic IP association reports a public address on the
   instance. Terraform now ignores that provider-derived field so runtime
   bundle updates cannot replace the host and its root database volume.

The OpenAI SecureString is bootstrapped by Terraform and then treated as an SSM
operator-owned rotation surface, matching the existing image-pointer pattern.
This removes unreadable SecureString churn; the post-proof plan is empty.

## Remaining gates

This is an infrastructure and internal-runtime proof, not the complete parent
acceptance run. Public HTTPS/DNS and Cloudflare routing were not changed or
tested. A generation probe for the available OpenAI credential remains blocked
by insufficient quota, so no planted-lead scoring, three-run hosted evaluation,
or model-cost claim is recorded here. Golden-state cloud restore and the
separate standard apply-to-destroy rehearsal remain their own gated tasks.

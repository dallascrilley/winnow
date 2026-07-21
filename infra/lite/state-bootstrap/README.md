# Lite Terraform state bootstrap

This root creates the one persistent S3 bucket needed to protect the lite
root's credential-bearing Terraform state. It intentionally uses local state
for its own seven nonsecret bucket-control resources, avoiding a circular
backend dependency. Both local state and the generated `../backend.hcl` are
ignored by Git.

The bucket uses SSE-S3, versioning, a 90-day noncurrent-version recovery
window, Bucket Owner Enforced ownership, all four Block Public Access controls,
and a bucket policy that denies non-TLS traffic and every principal except the
one explicit IAM user or role ARN. Native S3 lockfiles avoid a DynamoDB table;
SSE-S3 avoids a customer-managed KMS key and its recurring charge.

## No-cost local proof

```bash
operator_arn=$(./infra/lite/state-bootstrap/operator-principal.sh)
terraform -chdir=infra/lite/state-bootstrap init
terraform -chdir=infra/lite/state-bootstrap validate
terraform -chdir=infra/lite/state-bootstrap plan \
  -out=bootstrap.tfplan \
  -var="operator_principal_arn=${operator_arn}"
terraform -chdir=infra/lite/state-bootstrap show -json bootstrap.tfplan \
  > /tmp/inbound-lite-state-plan.json
node --test infra/lite/state-bootstrap/policy.test.mjs
INBOUND_LITE_STATE_PLAN_JSON=/tmp/inbound-lite-state-plan.json \
  node --test infra/lite/state-bootstrap/plan.test.mjs
```

`plan` reads AWS account metadata but creates nothing. Do not run `apply` until
the user approves the small persistent S3 cost and the exact operator principal
has been resolved to an IAM user or role ARN.

## Approved creation and lite initialization

```bash
operator_arn=$(./infra/lite/state-bootstrap/operator-principal.sh)
terraform -chdir=infra/lite/state-bootstrap apply \
  -var="operator_principal_arn=${operator_arn}"
./infra/lite/configure-backend.sh
terraform -chdir=infra/lite init -reconfigure \
  -backend-config=backend.hcl
terraform -chdir=infra/lite plan -out=lite.tfplan
```

If an applied local lite state exists, make a protected backup and use
`terraform init -migrate-state -backend-config=backend.hcl` instead. Never pass
AWS credentials through `-backend-config`; use the standard AWS environment or
shared configuration so credentials are not copied into `.terraform` or plan
files.

## Rotation and destruction

Rotate application credentials through the lite root, apply the rotation, and
then remove superseded S3 object versions only after confirming the new runtime
works. Old state versions remain credential material throughout the 90-day
recovery window.

To retire the backend, destroy the lite stack first. Copy the final state to an
encrypted recovery location if retention is required, empty every object
version and delete marker from the bucket as an explicit destructive action,
then destroy this bootstrap root. The bucket has `force_destroy = false`, so
Terraform cannot erase versioned state implicitly.

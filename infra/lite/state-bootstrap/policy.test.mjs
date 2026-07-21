import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const bootstrap = readFileSync(new URL("./main.tf", import.meta.url), "utf8");
const variables = readFileSync(
  new URL("./variables.tf", import.meta.url),
  "utf8",
);
const liteBackend = readFileSync(
  new URL("../backend.tf", import.meta.url),
  "utf8",
);
const liteIgnore = readFileSync(
  new URL("../.gitignore", import.meta.url),
  "utf8",
);
const localPlan = readFileSync(
  new URL("../local-plan.sh", import.meta.url),
  "utf8",
);
const operatorResolver = readFileSync(
  new URL("./operator-principal.sh", import.meta.url),
  "utf8",
);
const backendConfigurator = readFileSync(
  new URL("../configure-backend.sh", import.meta.url),
  "utf8",
);

test("state bucket is encrypted, versioned, private, and owner controlled", () => {
  assert.match(bootstrap, /aws_s3_bucket_server_side_encryption_configuration/);
  assert.match(bootstrap, /sse_algorithm\s*=\s*"AES256"/);
  assert.match(bootstrap, /aws_s3_bucket_versioning/);
  assert.match(bootstrap, /status\s*=\s*"Enabled"/);
  assert.match(bootstrap, /aws_s3_bucket_public_access_block/);
  assert.match(bootstrap, /block_public_acls\s*=\s*true/);
  assert.match(bootstrap, /block_public_policy\s*=\s*true/);
  assert.match(bootstrap, /ignore_public_acls\s*=\s*true/);
  assert.match(bootstrap, /restrict_public_buckets\s*=\s*true/);
  assert.match(bootstrap, /object_ownership\s*=\s*"BucketOwnerEnforced"/);
});

test("bucket policy fails closed to TLS and one IAM operator principal", () => {
  assert.match(bootstrap, /variable\s*=\s*"aws:SecureTransport"/);
  assert.match(bootstrap, /values\s*=\s*\["false"\]/);
  assert.match(bootstrap, /variable\s*=\s*"aws:PrincipalArn"/);
  assert.match(bootstrap, /values\s*=\s*\[var\.operator_principal_arn\]/);
  assert.match(variables, /operator_principal_arn/);
  assert.match(variables, /iam::\[0-9\]\{12\}:/);
  assert.match(operatorResolver, /aws sts get-caller-identity/);
  assert.match(operatorResolver, /aws iam get-role/);
  assert.match(operatorResolver, /assumed-role/);
});

test("state keeps bounded recovery history without paid locking or KMS", () => {
  assert.match(bootstrap, /noncurrent_version_expiration/);
  assert.match(bootstrap, /noncurrent_days\s*=\s*90/);
  assert.doesNotMatch(bootstrap, /aws_dynamodb_table|aws_kms_key/);
});

test("lite root uses encrypted native S3 locking and ignores local config", () => {
  assert.match(liteBackend, /backend\s+"s3"/);
  assert.match(liteBackend, /key\s*=\s*"lite\/terraform\.tfstate"/);
  assert.match(liteBackend, /encrypt\s*=\s*true/);
  assert.match(liteBackend, /use_lockfile\s*=\s*true/);
  assert.match(liteIgnore, /^backend\.hcl$/m);
  assert.match(localPlan, /--exclude='backend\.tf'/);
  assert.match(localPlan, /mktemp -d/);
  assert.match(localPlan, /terraform -chdir="\$\{PLAN_ROOT\}" plan/);
  assert.match(localPlan, /chmod 600 "\$\{OUTPUT_JSON\}"/);
  assert.match(backendConfigurator, /chmod 600 "\$\{BACKEND_CONFIG\}"/);
});

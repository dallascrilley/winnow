import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const planPath = process.env.INBOUND_LITE_STATE_PLAN_JSON;
if (!planPath) {
  throw new Error(
    "INBOUND_LITE_STATE_PLAN_JSON must point to `terraform show -json` output",
  );
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const changes = plan.resource_changes ?? [];
const managed = changes.filter((change) => change.mode === "managed");
const policyDocument = changes.find(
  (change) => change.address === "data.aws_iam_policy_document.state",
)?.change.after;

function resource(address) {
  const match = managed.find((change) => change.address === address);
  assert.ok(match, `missing planned resource ${address}`);
  return match.change.after;
}

test("bootstrap plan is seven additive S3 controls only", () => {
  assert.equal(managed.length, 7);
  assert.ok(
    managed.every(
      (change) =>
        change.address.startsWith("aws_s3_") &&
        change.change.actions.length === 1 &&
        change.change.actions[0] === "create",
    ),
  );
});

test("planned bucket controls protect and retain state", () => {
  const bucket = resource("aws_s3_bucket.state");
  const publicAccess = resource("aws_s3_bucket_public_access_block.state");
  const encryption = resource(
    "aws_s3_bucket_server_side_encryption_configuration.state",
  );
  const versioning = resource("aws_s3_bucket_versioning.state");

  assert.equal(bucket.force_destroy, false);
  assert.equal(publicAccess.block_public_acls, true);
  assert.equal(publicAccess.block_public_policy, true);
  assert.equal(publicAccess.ignore_public_acls, true);
  assert.equal(publicAccess.restrict_public_buckets, true);
  assert.equal(
    encryption.rule[0].apply_server_side_encryption_by_default[0].sse_algorithm,
    "AES256",
  );
  assert.equal(versioning.versioning_configuration[0].status, "Enabled");
});

test("planned policy pins one operator and denies every other principal", () => {
  assert.ok(policyDocument);
  const statements = Object.fromEntries(
    policyDocument.statement.map((statement) => [statement.sid, statement]),
  );
  const deniedArn = statements.DenyUnexpectedPrincipal.condition[0].values[0];
  const bucketPrincipal =
    statements.AllowOperatorBucketAccess.principals[0].identifiers[0];
  const statePrincipal =
    statements.AllowOperatorStateAccess.principals[0].identifiers[0];

  assert.match(deniedArn, /^arn:(aws|aws-us-gov|aws-cn):iam::/);
  assert.equal(bucketPrincipal, deniedArn);
  assert.equal(statePrincipal, deniedArn);
  assert.equal(
    statements.DenyInsecureTransport.condition[0].variable,
    "aws:SecureTransport",
  );
  assert.deepEqual(statements.AllowOperatorStateAccess.actions.toSorted(), [
    "s3:DeleteObject",
    "s3:GetObject",
    "s3:PutObject",
  ]);
});

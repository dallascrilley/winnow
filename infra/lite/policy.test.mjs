import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const planPath = process.env.INBOUND_LITE_PLAN_JSON;
if (!planPath) {
  throw new Error(
    "INBOUND_LITE_PLAN_JSON must point to `terraform show -json` output",
  );
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const resources = plan.planned_values?.root_module?.resources ?? [];
const changes = plan.resource_changes ?? [];
const iamSource = readFileSync(new URL("./iam.tf", import.meta.url), "utf8");
const backupSource = readFileSync(
  new URL("./backup.tf", import.meta.url),
  "utf8",
);
const userDataSources = [
  "./compute.tf",
  "./ssm.tf",
  "./user-data.sh.tftpl",
  "./deploy.sh",
  "./runtime/compose.yaml",
  "./runtime/Caddyfile",
  "./runtime/app-entrypoint.sh",
  "./runtime/healthcheck.sh",
  "./runtime/inbound-lite.service",
  "./runtime/inbound-lite-health.service",
  "./runtime/inbound-lite-health.timer",
  "./runtime/inbound-backup.service",
  "./runtime/inbound-backup.timer",
  "../../scripts/backup-golden-state.sh",
  "../../scripts/restore-golden-state.sh",
  "../../scripts/verify-golden-state.mjs",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

function resource(address) {
  const value = resources.find((candidate) => candidate.address === address);
  assert.ok(value, `missing planned resource ${address}`);
  return value.values;
}

test("host uses the bounded ARM64 size, encrypted gp3, and IMDSv2", () => {
  const instance = resource("aws_instance.origin");
  assert.equal(instance.instance_type, "t4g.medium");
  assert.deepEqual(instance.metadata_options, [
    {
      http_endpoint: "enabled",
      http_protocol_ipv6: "disabled",
      http_put_response_hop_limit: 1,
      http_tokens: "required",
      instance_metadata_tags: "enabled",
    },
  ]);
  assert.equal(instance.root_block_device[0].encrypted, true);
  assert.equal(instance.root_block_device[0].volume_type, "gp3");
  assert.equal(instance.root_block_device[0].volume_size, 30);
  assert.equal(instance.key_name ?? null, null);
  assert.equal(instance.user_data_replace_on_change, false);
  assert.match(
    userDataSources,
    /ignore_changes = \[ami, user_data, associate_public_ip_address\]/,
  );
});

test("security group exposes only HTTP and HTTPS", () => {
  const ingress = resource("aws_security_group.origin").ingress;
  assert.deepEqual(
    ingress.map((rule) => rule.from_port).sort((a, b) => a - b),
    [80, 443],
  );
  assert.ok(ingress.every((rule) => rule.protocol === "tcp"));
});

test("wake Lambda is serialized and API routes are natively throttled", () => {
  const lambda = resource("aws_lambda_function.wake");
  const stage = resource("aws_apigatewayv2_stage.default");
  assert.equal(lambda.reserved_concurrent_executions, 1);
  assert.equal(lambda.runtime, "nodejs22.x");
  assert.deepEqual(lambda.architectures, ["arm64"]);
  assert.equal(stage.default_route_settings[0].throttling_burst_limit, 2);
  assert.equal(stage.default_route_settings[0].throttling_rate_limit, 1);
});

test("replay table is encrypted, TTL-backed, and request-priced", () => {
  const table = resource("aws_dynamodb_table.control");
  assert.equal(table.billing_mode, "PAY_PER_REQUEST");
  assert.deepEqual(table.ttl, [
    { attribute_name: "expires_at", enabled: true },
  ]);
  assert.equal(table.server_side_encryption[0].enabled, true);
});

test("golden-state bucket is private, versioned, encrypted, and recovery-bounded", () => {
  const bucket = resource("aws_s3_bucket.backup");
  assert.match(bucket.bucket, /^inbound-lite-golden-state-[0-9]{12}$/);
  assert.equal(bucket.force_destroy, false);
  assert.equal(
    resource("aws_s3_bucket_versioning.backup").versioning_configuration[0]
      .status,
    "Enabled",
  );
  assert.equal(
    resource("aws_s3_bucket_server_side_encryption_configuration.backup")
      .rule[0].apply_server_side_encryption_by_default[0].sse_algorithm,
    "AES256",
  );
  assert.deepEqual(resource("aws_s3_bucket_public_access_block.backup"), {
    block_public_acls: true,
    block_public_policy: true,
    ignore_public_acls: true,
    restrict_public_buckets: true,
  });
  assert.equal(
    resource("aws_s3_bucket_ownership_controls.backup").rule[0]
      .object_ownership,
    "BucketOwnerEnforced",
  );
  const lifecycleRules = resource(
    "aws_s3_bucket_lifecycle_configuration.backup",
  ).rule;
  assert.deepEqual(lifecycleRules.map((rule) => rule.id).sort(), [
    "expire-noncurrent-golden-state",
    "expire-noncurrent-runtime-bundle",
  ]);
  assert.ok(
    lifecycleRules.every(
      (rule) => rule.noncurrent_version_expiration[0].noncurrent_days === 30,
    ),
  );
  const runtimeBundle = resource("aws_s3_object.runtime");
  assert.equal(runtimeBundle.key, "runtime/runtime-bundle.zip");
  assert.equal(runtimeBundle.server_side_encryption, "AES256");
  assert.match(iamSource, /sid\s*=\s*"ReadWriteGoldenState"/);
  assert.ok(
    iamSource.includes(
      'resources = ["${aws_s3_bucket.backup.arn}/${local.backup_prefix}/*"]',
    ),
  );
  assert.ok(
    iamSource.includes(
      'resources = ["${aws_s3_bucket.backup.arn}/${local.runtime_prefix}/runtime-bundle.zip"]',
    ),
  );
  assert.doesNotMatch(iamSource, /s3:DeleteObject|s3:ListAllMyBuckets/);
  assert.match(backupSource, /sid\s*=\s*"DenyInsecureTransport"/);
  assert.match(backupSource, /variable\s*=\s*"aws:SecureTransport"/);
  assert.match(backupSource, /values\s*=\s*\["false"\]/);
});

test("lifecycle IAM controls only the planned tagged instance and named schedule", () => {
  assert.ok(
    resources.some((item) => item.address === "aws_iam_role_policy.wake"),
  );
  assert.match(
    iamSource,
    /actions\s*=\s*\["ec2:StartInstances", "ec2:StopInstances"\]/,
  );
  assert.match(iamSource, /instance\/\$\{aws_instance\.origin\.id\}/);
  assert.match(iamSource, /variable\s*=\s*"ec2:ResourceTag\/project"/);
  assert.match(iamSource, /values\s*=\s*\[local\.name\]/);
  assert.match(
    iamSource,
    /actions\s*=\s*\["scheduler:CreateSchedule", "scheduler:UpdateSchedule"\]/,
  );
  assert.match(
    iamSource,
    /schedule\/\$\{aws_scheduler_schedule_group\.lifecycle\.name\}\/\$\{local\.name\}-stop/,
  );
  assert.match(
    iamSource,
    /variable\s*=\s*"iam:PassedToService"[\s\S]*?values\s*=\s*\["scheduler\.amazonaws\.com"\]/,
  );
});

test("user-data inputs contain no secret value or concrete AWS identifier", () => {
  assert.match(resource("aws_instance.origin").user_data, /^[0-9a-f]{40}$/);
  assert.doesNotMatch(
    userDataSources,
    /AKIA[0-9A-Z]{16}|arn:aws|\b\d{12}\b|i-[0-9a-f]{8,17}/,
  );
  assert.doesNotMatch(
    userDataSources,
    /OPENAI_API_KEY=[^$]|BETTER_AUTH_SECRET=[^$]|A2A_SECRET=[^$]/,
  );
  assert.match(userDataSources, /trap 'shutdown -h now \|\| true' EXIT/);
  assert.doesNotMatch(userDataSources, /\bawscli2\b/);
  assert.match(userDataSources, /command -v aws >\/dev\/null/);
  assert.match(userDataSources, /command -v curl >\/dev\/null/);
  assert.match(userDataSources, /dnf install -y docker jq unzip/);
  assert.doesNotMatch(userDataSources, /dnf install -y[^\n]*\bcurl\b/);
  assert.doesNotMatch(userDataSources, /--output text > "\$output"/);
  assert.match(userDataSources, /printf '%s' "\$parameter_value" > "\$output"/);
  assert.match(
    userDataSources,
    /resource "aws_ssm_parameter" "openai_api_key"[\s\S]*?ignore_changes = \[value\]/,
  );
  assert.match(userDataSources, /--env-file \/run\/inbound-lite\/runtime\.env/);
  assert.equal(
    plan.variables.origin_hostname.value,
    "inbound-origin.dallascrilley.com",
  );
  assert.match(
    userDataSources,
    /INBOUND_LITE_PUBLIC_URL=https:\/\/\$\{var\.origin_hostname\}/,
  );
  assert.match(
    userDataSources,
    /systemctl enable --now inbound-lite-health\.timer/,
  );
  assert.match(userDataSources, /systemctl enable --now inbound-backup\.timer/);
  assert.match(
    userDataSources,
    /ExecStop=-\/opt\/inbound-lite\/backup-golden-state\.sh/,
  );
});

test("plan is additive only and includes the project budget", () => {
  assert.ok(changes.length > 0);
  assert.ok(changes.every((item) => !item.change.actions.includes("delete")));
  const budget = resource("aws_budgets_budget.monthly");
  assert.equal(budget.limit_amount, "10");
  assert.deepEqual(budget.cost_filter, [
    {
      name: "TagKeyValue",
      values: ["user:project$inbound-lite"],
    },
  ]);
});

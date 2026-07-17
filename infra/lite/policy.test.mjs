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
const userDataSources = [
  "./compute.tf",
  "./user-data.sh.tftpl",
  "./deploy.sh",
  "./runtime/compose.yaml",
  "./runtime/Caddyfile",
  "./runtime/app-entrypoint.sh",
  "./runtime/healthcheck.sh",
  "./runtime/inbound-lite.service",
  "./runtime/inbound-lite-health.service",
  "./runtime/inbound-lite-health.timer",
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

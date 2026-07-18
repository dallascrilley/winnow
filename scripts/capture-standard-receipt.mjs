#!/usr/bin/env node
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INPUT_FIELDS = new Set([
  "version",
  "gitSha",
  "startedAt",
  "finishedAt",
  "region",
  "terraformVersion",
  "appImageRef",
  "ollamaImageRef",
  "taskDefinitionRevision",
  "smoke",
  "eval",
  "estimatedCostUsd",
  "teardownStatus",
  "residualInventory",
]);
const RESIDUAL_FIELDS = [
  "terraformResources",
  "ecsClusters",
  "rdsInstances",
  "rdsSnapshots",
  "loadBalancers",
  "acmCertificates",
  "ecrRepositories",
  "logGroups",
  "ssmParameters",
];

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireExactFields(value, fields, label) {
  requireObject(value, label);
  const expected = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) {
      throw new Error(`unexpected ${label} field: ${field}`);
    }
  }
  for (const field of expected) {
    if (!(field in value)) throw new Error(`missing ${label} field: ${field}`);
  }
}

function imageDigest(reference, repository, region) {
  if (typeof reference !== "string") throw new Error("invalid image reference");
  const pattern = new RegExp(
    `^[0-9]{12}\\.dkr\\.ecr\\.${region.replaceAll("-", "\\-")}\\.amazonaws\\.com/${repository}@(sha256:[0-9a-f]{64})$`,
  );
  const match = reference.match(pattern);
  if (!match)
    throw new Error(`invalid immutable ${repository} image reference`);
  return match[1];
}

export function buildStandardReceipt(input) {
  requireObject(input, "receipt input");
  for (const field of Object.keys(input)) {
    if (!INPUT_FIELDS.has(field)) {
      throw new Error(`unexpected receipt input field: ${field}`);
    }
  }
  for (const field of INPUT_FIELDS) {
    if (!(field in input))
      throw new Error(`missing receipt input field: ${field}`);
  }

  if (input.version !== 1) throw new Error("unsupported receipt input version");
  if (!/^[0-9a-f]{40}$/.test(input.gitSha)) throw new Error("invalid Git SHA");
  if (!/^[a-z]{2}-[a-z]+-[0-9]$/.test(input.region)) {
    throw new Error("invalid AWS region");
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(input.terraformVersion)) {
    throw new Error("invalid Terraform version");
  }

  const started = Date.parse(input.startedAt);
  const finished = Date.parse(input.finishedAt);
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(finished) ||
    finished < started
  ) {
    throw new Error("invalid proof time range");
  }
  const durationHours = (finished - started) / 3_600_000;
  if (durationHours > 24) throw new Error("standard proof exceeded 24 hours");

  const appDigest = imageDigest(
    input.appImageRef,
    "inbound-demo",
    input.region,
  );
  const ollamaDigest = imageDigest(
    input.ollamaImageRef,
    "inbound-demo-ollama",
    input.region,
  );

  if (
    !Number.isInteger(input.taskDefinitionRevision) ||
    input.taskDefinitionRevision < 1
  ) {
    throw new Error("invalid task-definition revision");
  }
  requireExactFields(input.smoke, ["passed", "terminalStatus"], "smoke");
  if (input.smoke.passed !== true || input.smoke.terminalStatus !== "routed") {
    throw new Error("planted-lead smoke is not verified");
  }
  requireExactFields(
    input.eval,
    ["model", "accuracy", "caseCount", "passCount", "imageDigest"],
    "eval",
  );
  if (input.eval.model !== "qwen3:4b") throw new Error("unexpected eval model");
  if (!Number.isInteger(input.eval.caseCount) || input.eval.caseCount < 1) {
    throw new Error("invalid eval case count");
  }
  if (
    !Number.isInteger(input.eval.passCount) ||
    input.eval.passCount < 0 ||
    input.eval.passCount > input.eval.caseCount
  ) {
    throw new Error("invalid eval pass count");
  }
  if (!Number.isFinite(input.eval.accuracy) || input.eval.accuracy < 0.9) {
    throw new Error("offline eval accuracy is below 90 percent");
  }
  if (
    Math.abs(
      input.eval.accuracy - input.eval.passCount / input.eval.caseCount,
    ) > 0.0001
  ) {
    throw new Error("eval accuracy does not match pass count");
  }
  if (input.eval.imageDigest !== ollamaDigest) {
    throw new Error(
      "eval image digest does not match the deployed Ollama image",
    );
  }
  if (
    !Number.isFinite(input.estimatedCostUsd) ||
    input.estimatedCostUsd < 0 ||
    input.estimatedCostUsd > 5
  ) {
    throw new Error("estimated proof cost exceeds the five-dollar ceiling");
  }
  if (input.teardownStatus !== "verified") {
    throw new Error("teardown is not verified");
  }

  requireExactFields(
    input.residualInventory,
    RESIDUAL_FIELDS,
    "residual inventory",
  );
  for (const field of RESIDUAL_FIELDS) {
    if (input.residualInventory[field] !== 0) {
      throw new Error(`residual standard resource remains: ${field}`);
    }
  }

  return {
    version: 1,
    observedAt: new Date(finished).toISOString(),
    gitSha: input.gitSha,
    region: input.region,
    terraformVersion: input.terraformVersion,
    durationHours: Number(durationHours.toFixed(4)),
    estimatedCostUsd: Number(input.estimatedCostUsd.toFixed(2)),
    topology: {
      compute: "ECS Fargate ARM64, 2 vCPU, 8 GB RAM",
      database: "RDS PostgreSQL 16, db.t4g.micro, Single-AZ, 20 GB gp3",
      ingress: "Application Load Balancer",
    },
    taskDefinitionRevision: input.taskDefinitionRevision,
    images: { appDigest, ollamaDigest },
    smoke: input.smoke,
    eval: input.eval,
    teardownStatus: "verified",
    residualInventory: input.residualInventory,
  };
}

export function writeStandardReceipt(input, outputPath) {
  const output = resolve(outputPath);
  const temporary = `${output}.${process.pid}.tmp`;
  mkdirSync(dirname(output), { recursive: true });
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify(buildStandardReceipt(input), null, 2)}\n`,
      { mode: 0o600 },
    );
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error(
      "usage: capture-standard-receipt.mjs <proof-input.json> <latest.json>",
    );
    process.exitCode = 2;
  } else {
    try {
      const input = JSON.parse(readFileSync(inputPath, "utf8"));
      writeStandardReceipt(input, outputPath);
      console.log(`wrote verified standard receipt: ${outputPath}`);
    } catch (error) {
      console.error(`standard receipt rejected: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

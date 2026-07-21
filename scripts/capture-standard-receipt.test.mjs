import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  buildStandardReceipt,
  writeStandardReceipt,
} from "./capture-standard-receipt.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function validInput() {
  return {
    version: 1,
    gitSha: "a".repeat(40),
    startedAt: "2026-07-18T10:00:00.000Z",
    finishedAt: "2026-07-18T12:00:00.000Z",
    region: "us-east-1",
    terraformVersion: "1.13.5",
    appImageRef: `123456789012.dkr.ecr.us-east-1.amazonaws.com/inbound-demo@sha256:${"b".repeat(64)}`,
    ollamaImageRef: `123456789012.dkr.ecr.us-east-1.amazonaws.com/inbound-demo-ollama@sha256:${"c".repeat(64)}`,
    taskDefinitionRevision: 4,
    smoke: { passed: true, terminalStatus: "routed" },
    eval: {
      model: "qwen3:4b",
      accuracy: 0.9583,
      caseCount: 24,
      passCount: 23,
      imageDigest: `sha256:${"c".repeat(64)}`,
    },
    estimatedCostUsd: 0.42,
    teardownStatus: "verified",
    residualInventory: {
      terraformResources: 0,
      ecsClusters: 0,
      rdsInstances: 0,
      rdsSnapshots: 0,
      loadBalancers: 0,
      acmCertificates: 0,
      ecrRepositories: 0,
      logGroups: 0,
      ssmParameters: 0,
    },
  };
}

test("builds a sanitized verified receipt", () => {
  const receipt = buildStandardReceipt(validInput());

  assert.equal(receipt.gitSha, "a".repeat(40));
  assert.equal(receipt.durationHours, 2);
  assert.equal(receipt.images.appDigest, `sha256:${"b".repeat(64)}`);
  assert.equal(receipt.images.ollamaDigest, `sha256:${"c".repeat(64)}`);
  assert.equal(receipt.eval.accuracy, 0.9583);
  assert.equal(receipt.teardownStatus, "verified");
  assert.doesNotMatch(JSON.stringify(receipt), /123456789012|amazonaws\.com/);
});

test("rejects incomplete proof or cost bounds", () => {
  const cases = [
    ["low accuracy", { eval: { ...validInput().eval, accuracy: 0.89 } }],
    ["wrong model", { eval: { ...validInput().eval, model: "hosted-model" } }],
    ["mutable image", { appImageRef: "example.invalid/inbound:latest" }],
    ["long run", { finishedAt: "2026-07-19T11:00:01.000Z" }],
    ["over budget", { estimatedCostUsd: 5.01 }],
    ["unverified teardown", { teardownStatus: "retained" }],
    [
      "residual resource",
      {
        residualInventory: {
          ...validInput().residualInventory,
          rdsInstances: 1,
        },
      },
    ],
  ];

  for (const [name, overrides] of cases) {
    const input = { ...validInput(), ...overrides };
    assert.throws(() => buildStandardReceipt(input), undefined, name);
  }
});

test("rejects unexpected state or secret-bearing fields", () => {
  assert.throws(
    () =>
      buildStandardReceipt({
        ...validInput(),
        terraformState: { outputs: { password: "sk-test-example" } },
      }),
    /unexpected receipt input field/,
  );
});

test("writes deterministic JSON atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "standard-receipt-"));
  temporaryDirectories.push(directory);
  const output = join(directory, "latest.json");

  writeStandardReceipt(validInput(), output);
  const parsed = JSON.parse(readFileSync(output, "utf8"));

  assert.deepEqual(parsed, buildStandardReceipt(validInput()));
  assert.match(readFileSync(output, "utf8"), /\n$/);
});

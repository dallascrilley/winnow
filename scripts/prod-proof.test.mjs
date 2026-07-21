import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEvalProof } from "./prod-proof.mjs";

const digest = `sha256:${"d".repeat(64)}`;

test("builds the bounded offline eval marker", () => {
  assert.deepEqual(
    buildEvalProof(
      {
        model: "qwen3:4b",
        summary: { accuracy: 0.95, caseCount: 20, passCount: 19 },
      },
      digest,
    ),
    {
      model: "qwen3:4b",
      accuracy: 0.95,
      caseCount: 20,
      passCount: 19,
      imageDigest: digest,
    },
  );
});

test("rejects the wrong model, low accuracy, or mutable identity", () => {
  assert.throws(() =>
    buildEvalProof(
      { model: "hosted", summary: { accuracy: 1, caseCount: 1, passCount: 1 } },
      digest,
    ),
  );
  assert.throws(() =>
    buildEvalProof(
      {
        model: "qwen3:4b",
        summary: { accuracy: 0.89, caseCount: 1, passCount: 0 },
      },
      digest,
    ),
  );
  assert.throws(() =>
    buildEvalProof(
      {
        model: "qwen3:4b",
        summary: { accuracy: 1, caseCount: 1, passCount: 1 },
      },
      "latest",
    ),
  );
});

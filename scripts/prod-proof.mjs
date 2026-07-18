#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function buildEvalProof(result, expectedImageDigest) {
  const { summary } = result;
  if (result.model !== "qwen3:4b") throw new Error("unexpected eval model");
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedImageDigest)) {
    throw new Error("missing immutable Ollama image digest");
  }
  if (summary.accuracy < 0.9) {
    throw new Error("offline eval accuracy is below 90 percent");
  }
  return {
    model: result.model,
    accuracy: summary.accuracy,
    caseCount: summary.caseCount,
    passCount: summary.passCount,
    imageDigest: expectedImageDigest,
  };
}

async function main() {
  await import("./prod-seed.mjs");
  const { runEval } = await import("../apps/qualify/server/lib/eval-runner.ts");
  const result = await runEval();
  const proof = buildEvalProof(result, process.env.OLLAMA_IMAGE_DIGEST ?? "");
  const encoded = Buffer.from(JSON.stringify(proof)).toString("base64url");
  console.log(`STANDARD_PROOF_EVAL_BASE64=${encoded}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`standard runtime proof failed: ${error.message}`);
    process.exitCode = 1;
  });
}

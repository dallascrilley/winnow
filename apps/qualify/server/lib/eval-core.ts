import { createHash } from "node:crypto";

import type { Segment, Tier } from "./scoring.js";

/**
 * Pure eval-suite logic — comparison, summary, and run identity. Kept free of
 * server-chain imports so vitest can load it (see receipts U2: the core
 * server chain breaks under vitest's runner).
 */

export interface Golden {
  expectedTier: Tier;
  expectedSegment: Segment;
  expectedShouldRoute: boolean;
}

export interface Actual {
  tier: Tier;
  segment: Segment;
  shouldRoute: boolean;
}

export interface CaseComparison {
  pass: boolean;
  failures: string[];
}

export function compareCase(expected: Golden, actual: Actual): CaseComparison {
  const failures: string[] = [];
  if (actual.tier !== expected.expectedTier) {
    failures.push(
      `tier: expected ${expected.expectedTier}, got ${actual.tier}`,
    );
  }
  if (actual.segment !== expected.expectedSegment) {
    failures.push(
      `segment: expected ${expected.expectedSegment}, got ${actual.segment}`,
    );
  }
  if (actual.shouldRoute !== expected.expectedShouldRoute) {
    failures.push(
      `shouldRoute: expected ${expected.expectedShouldRoute}, got ${actual.shouldRoute}`,
    );
  }
  return { pass: failures.length === 0, failures };
}

export interface CaseResult {
  caseId: string;
  tier: Tier;
  segment: Segment;
  shouldRoute: boolean;
  pass: boolean;
  failures: string[];
  tags: string[];
}

export interface EvalSummary {
  caseCount: number;
  passCount: number;
  accuracy: number;
  byTag: Record<string, { total: number; passed: number; accuracy: number }>;
}

export function summarize(results: CaseResult[]): EvalSummary {
  const passCount = results.filter((r) => r.pass).length;
  const byTag: EvalSummary["byTag"] = {};
  for (const r of results) {
    for (const tag of r.tags) {
      byTag[tag] ??= { total: 0, passed: 0, accuracy: 0 };
      byTag[tag].total += 1;
      if (r.pass) byTag[tag].passed += 1;
    }
  }
  for (const t of Object.values(byTag)) {
    t.accuracy = t.total === 0 ? 0 : t.passed / t.total;
  }
  return {
    caseCount: results.length,
    passCount,
    accuracy: results.length === 0 ? 0 : passCount / results.length,
    byTag,
  };
}

/**
 * Hash of everything that determines a run's output besides the model: ICP
 * text, system prompt, and the full case set (inputs + goldens). A score
 * change is attributable to exactly one of (model, promptHash) changing.
 */
export function promptHashFor(
  icp: string,
  systemPrompt: string,
  cases: unknown[],
): string {
  return createHash("sha256")
    .update(icp)
    .update("|")
    .update(systemPrompt)
    .update("|")
    .update(JSON.stringify(cases))
    .digest("hex")
    .slice(0, 12);
}

/** Deterministic run id — a rerun with the same config replaces, not piles up. */
export function runIdFor(model: string, promptHash: string): string {
  return `eval_${model.replace(/[^a-z0-9.-]/gi, "-")}_${promptHash}`;
}

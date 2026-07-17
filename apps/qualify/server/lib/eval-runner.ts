import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";
import { enrich } from "./enrichment.js";
import {
  compareCase,
  promptHashFor,
  runIdFor,
  summarize,
  type CaseResult,
  type EvalSummary,
} from "./eval-core.js";
import { trackFunnelEvent } from "./funnel-track.js";
import { loadIcp } from "./leads.js";
import {
  bandForScore,
  PROMPT_RULES,
  scoreIcp,
  SYSTEM_PROMPT,
  type CallLlm,
} from "./scoring.js";

/**
 * Eval-suite runner (U6). Runs enrichment + scoring over the seeded golden
 * cases — never touching the leads table — and persists one `eval_runs` row
 * per (model, promptHash). Rerunning with an unchanged config replaces the
 * row; changing the ICP or the model writes a new one, so the gate is visible
 * in history.
 */

export interface EvalRunResult {
  runId: string;
  model: string;
  promptHash: string;
  summary: EvalSummary;
  totalCostUsd: number;
  results: CaseResult[];
}

export async function runEval(options?: {
  callLlm?: CallLlm;
  db?: ReturnType<typeof getDb>;
}): Promise<EvalRunResult> {
  const db = options?.db ?? getDb();
  const cases = await db.select().from(schema.evalCases);
  if (cases.length === 0) {
    throw new Error("no eval cases seeded — run `pnpm --filter qualify seed`");
  }
  const icp = await loadIcp(db);

  const results: CaseResult[] = [];
  let totalCostUsd = 0;
  let model = "unknown";

  for (const c of cases) {
    const input = JSON.parse(c.input) as {
      email: string;
      name?: string;
      companySize?: string;
      message?: string;
    };
    const profile = await enrich(input, db);
    const { score, usage } = await scoreIcp(
      icp,
      {
        profile,
        name: input.name ?? null,
        companySize: input.companySize ?? null,
        message: input.message ?? null,
      },
      options?.callLlm ?? undefined,
    );
    model = usage.model;
    totalCostUsd += usage.costUsd;

    const shouldRoute = bandForScore(score.fitScore) === "auto";
    const comparison = compareCase(
      {
        expectedTier: c.expectedTier,
        expectedSegment: c.expectedSegment,
        expectedShouldRoute: c.expectedShouldRoute,
      },
      { tier: score.tier, segment: score.segment, shouldRoute },
    );
    results.push({
      caseId: c.id,
      tier: score.tier,
      segment: score.segment,
      shouldRoute,
      pass: comparison.pass,
      failures: comparison.failures,
      tags: JSON.parse(c.tags) as string[],
    });
  }

  const summary = summarize(results);
  const promptHash = promptHashFor(
    icp,
    `${SYSTEM_PROMPT}\n${PROMPT_RULES.join("\n")}`,
    cases,
  );
  const runId = runIdFor(model, promptHash);

  // Portable upsert by deterministic id (SQLite + Postgres).
  await db.delete(schema.evalRuns).where(eq(schema.evalRuns.id, runId));
  await db.insert(schema.evalRuns).values({
    id: runId,
    model,
    promptHash,
    caseCount: summary.caseCount,
    passCount: summary.passCount,
    accuracy: summary.accuracy,
    totalCostUsd,
    results: JSON.stringify(
      results.map(({ caseId, tier, segment, shouldRoute, pass, failures }) => ({
        caseId,
        tier,
        segment,
        shouldRoute,
        pass,
        failures,
      })),
    ),
    createdAt: new Date().toISOString(),
  });

  // Feed the U7 funnel/dashboard: latest accuracy shows up as a first-party
  // event, keyed by run id so the dashboard always reads the newest.
  trackFunnelEvent("eval_completed", runId, {
    accuracy: summary.accuracy,
    caseCount: summary.caseCount,
    passCount: summary.passCount,
    model,
    promptHash,
  });

  return { runId, model, promptHash, summary, totalCostUsd, results };
}

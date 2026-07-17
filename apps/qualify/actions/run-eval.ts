import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runEval } from "../server/lib/eval-runner.js";

/**
 * Run the golden eval suite against the current ICP + model. Owner-only —
 * full per-case detail including failures is returned here; the public
 * surface (get-eval-status) exposes only the aggregate score.
 */
export default defineAction({
  description:
    "Run the qualifier eval suite: enrichment + ICP scoring over the seeded golden cases, persisted as an eval_runs row keyed by (model, prompt hash). Returns accuracy, per-tag breakdown, and failing cases.",
  schema: z.object({}),
  http: { method: "POST" },
  run: async () => {
    const { runId, model, promptHash, summary, totalCostUsd, results } =
      await runEval();
    return {
      runId,
      model,
      promptHash,
      accuracy: summary.accuracy,
      caseCount: summary.caseCount,
      passCount: summary.passCount,
      byTag: summary.byTag,
      totalCostUsd,
      failing: results
        .filter((r) => !r.pass)
        .map((r) => ({ caseId: r.caseId, failures: r.failures })),
    };
  },
});

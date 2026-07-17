import { defineAction } from "@agent-native/core/action";
import { desc } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/**
 * Anonymous read of the latest eval run — the public "qualifier accuracy"
 * number shown on the status page footer and the U7 dashboard. Aggregate
 * only: no case inputs, no failure detail (that stays owner-only in run-eval).
 *
 * Registered in server/plugins/auth.ts publicPaths.
 */
export default defineAction({
  description:
    "Public read of the latest qualifier eval run: accuracy, case count, model, and date. Aggregate only, no case-level detail.",
  schema: z.object({}),
  http: { method: "GET" },
  requiresAuth: false,
  run: async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.evalRuns)
      .orderBy(desc(schema.evalRuns.createdAt))
      .limit(1);
    const run = rows[0];
    if (!run) return { found: false as const };
    return {
      found: true as const,
      eval: {
        accuracy: run.accuracy,
        caseCount: run.caseCount,
        passCount: run.passCount,
        model: run.model,
        promptHash: run.promptHash,
        createdAt: run.createdAt,
      },
    };
  },
});

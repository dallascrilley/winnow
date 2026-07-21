import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { LEAD_STATUSES } from "../server/db/schema.js";

export default defineAction({
  description: "List recent leads, optionally filtered by status.",
  schema: z.object({
    status: z.enum(LEAD_STATUSES).optional(),
    limit: z.number().int().min(1).max(100).optional().default(25),
  }),
  http: { method: "GET" },
  run: async ({ status, limit }) => {
    const db = getDb();
    const base = db
      .select({
        id: schema.leads.id,
        email: schema.leads.email,
        name: schema.leads.name,
        status: schema.leads.status,
        fitScore: schema.leads.fitScore,
        tier: schema.leads.tier,
        segment: schema.leads.segment,
        llmCostUsd: schema.leads.llmCostUsd,
        scoreReasoning: schema.leads.scoreReasoning,
        createdAt: schema.leads.createdAt,
        formResponseId: schema.leads.formResponseId,
      })
      .from(schema.leads)
      .orderBy(desc(schema.leads.createdAt))
      .limit(limit);

    const rows = status
      ? await base.where(eq(schema.leads.status, status))
      : await base;
    return { leads: rows };
  },
});

import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  resolveJourneyToken,
  stageLabelForLeadStatus,
} from "../server/lib/journey-token.js";

/**
 * Anonymous highlight for the public funnel: opaque journey token → stage
 * label only. No lead identifiers leave this action.
 */
export default defineAction({
  description:
    "Public funnel highlight from opaque journey token (stage label only, no lead ids).",
  schema: z.object({
    token: z.string().min(16),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  run: async ({ token }) => {
    const formResponseId = await resolveJourneyToken(token);
    if (!formResponseId) {
      return { found: false as const };
    }
    const db = getDb();
    const rows = await db
      .select({ status: schema.leads.status })
      .from(schema.leads)
      .where(eq(schema.leads.formResponseId, formResponseId))
      .limit(1);
    const status = rows[0]?.status;
    if (!status) return { found: false as const };
    const stageLabel = stageLabelForLeadStatus(status);
    if (!stageLabel) return { found: false as const };
    return {
      found: true as const,
      advanced: true as const,
      stageLabel,
    };
  },
});

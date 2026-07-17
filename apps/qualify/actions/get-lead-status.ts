import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseAudit } from "../server/lib/leads.js";

/**
 * Anonymous, capability-keyed read for the public status page. The forms
 * response id (a nanoid the submitter receives via redirect) is the lookup
 * key — unguessable, so no session is required. Returns a sanitized
 * projection: no owner email, org, or raw form payload.
 *
 * Registered in server/plugins/auth.ts publicPaths.
 */
export default defineAction({
  description:
    "Public read of a lead's qualification status by form response id (capability key, sanitized projection).",
  schema: z.object({
    responseId: z.string().min(1),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  run: async ({ responseId }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.formResponseId, responseId))
      .limit(1);
    const lead = rows[0];

    if (!lead) {
      // The async A2A handoff may not have created the lead yet — the status
      // page keeps polling and shows "waiting for pickup" meanwhile.
      return { found: false as const };
    }

    return {
      found: true as const,
      lead: {
        id: lead.id,
        status: lead.status,
        name: lead.name,
        email: lead.email,
        fitScore: lead.fitScore,
        tier: lead.tier,
        segment: lead.segment,
        scoreReasoning: lead.scoreReasoning,
        proposal: lead.proposal ? JSON.parse(lead.proposal) : null,
        enrichment: lead.enrichment ? JSON.parse(lead.enrichment) : null,
        llmModel: lead.llmModel,
        llmCostUsd: lead.llmCostUsd,
        audit: parseAudit(lead.audit),
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      },
    };
  },
});

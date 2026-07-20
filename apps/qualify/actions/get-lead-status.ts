import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { issueJourneyToken } from "../server/lib/journey-token.js";
import { parseAudit } from "../server/lib/leads.js";

/**
 * Anonymous, capability-keyed read for the public status page. The forms
 * response id (a nanoid the submitter receives via redirect) is the lookup
 * key — unguessable, so no session is required. Returns a sanitized
 * projection: no owner email, org, raw form payload, internal lead id, or
 * operator telemetry (model/cost). Issues a short-lived opaque journeyToken
 * for cross-app funnel highlight.
 *
 * Registered in server/plugins/auth.ts publicPaths.
 */
export default defineAction({
  description:
    "Public read of a lead's qualification status by form response id (capability key, sanitized projection + journey token).",
  schema: z.object({
    responseId: z.string().min(1),
    /** Query flag from status page; only the string "true" mints a token. */
    issueJourney: z.string().optional(),
  }),
  http: { method: "POST" },
  requiresAuth: false,
  run: async ({ responseId, issueJourney: issueJourneyRaw }) => {
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

    let journeyToken: string | null = null;
    if (issueJourneyRaw === "true") {
      try {
        // Always mint a fresh opaque token for this page load (multiple
        // concurrent hashes per formResponseId are fine; resolve is by hash).
        journeyToken = await issueJourneyToken(responseId, undefined, {
          force: true,
        });
      } catch {
        journeyToken = null;
      }
    }
    return {
      found: true as const,
      lead: {
        status: lead.status,
        name: lead.name,
        fitScore: lead.fitScore,
        tier: lead.tier,
        segment: lead.segment,
        scoreReasoning: lead.scoreReasoning,
        proposal: lead.proposal ? JSON.parse(lead.proposal) : null,
        enrichment: lead.enrichment ? JSON.parse(lead.enrichment) : null,
        audit: parseAudit(lead.audit),
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        journeyToken,
      },
    };
  },
});

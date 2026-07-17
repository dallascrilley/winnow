import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { appendAudit, getLeadOrThrow } from "../server/lib/leads.js";
import { proposalFor } from "../server/lib/scoring.js";

/**
 * Turn a lead's score into a routing proposal using the band policy
 * (>=0.8 auto-approve, 0.4–0.8 human review, <0.4 disqualify). This only
 * proposes — the scheduler app routes (U4) after the U5 approval gate.
 */
export default defineAction({
  description:
    "Compute the routing proposal for a scored lead (band policy) and advance its status. Does not route.",
  schema: z.object({
    leadId: z.string().describe("Lead id in status 'scored'"),
  }),
  http: { method: "POST" },
  run: async ({ leadId }) => {
    const db = getDb();
    const lead = await getLeadOrThrow(leadId, db);
    if (lead.fitScore === null || !lead.tier || !lead.segment) {
      throw new Error(`lead ${leadId} is not scored yet — run score-icp first`);
    }

    const proposal = proposalFor({
      fitScore: lead.fitScore,
      tier: lead.tier,
      segment: lead.segment,
      reasoning: lead.scoreReasoning ?? "",
    });

    const status =
      proposal.band === "auto"
        ? "approved"
        : proposal.band === "review"
          ? "pending_approval"
          : "disqualified";

    await db
      .update(schema.leads)
      .set({
        proposal: JSON.stringify(proposal),
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.leads.id, leadId));

    await appendAudit(
      leadId,
      { actor: "system", event: "routing-proposed", detail: proposal.reason },
      db,
    );

    return { leadId, proposal, status };
  },
});

import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getLeadOrThrow, parseAudit } from "../server/lib/leads.js";

export default defineAction({
  description:
    "Fetch one lead by id with parsed enrichment, proposal, and audit timeline.",
  schema: z.object({
    leadId: z.string(),
  }),
  http: { method: "GET" },
  run: async ({ leadId }) => {
    const lead = await getLeadOrThrow(leadId);
    return {
      lead: {
        ...lead,
        enrichment: lead.enrichment ? JSON.parse(lead.enrichment) : null,
        proposal: lead.proposal ? JSON.parse(lead.proposal) : null,
        audit: parseAudit(lead.audit),
      },
    };
  },
});

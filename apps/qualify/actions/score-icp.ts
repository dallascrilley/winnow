import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { scoreLeadStep } from "../server/lib/chain.js";

/**
 * Score an enriched lead against the ICP definition with a direct LLM call.
 * Writes the score, tier, segment, reasoning, and the token-cost ledger onto
 * the lead, then marks it "scored".
 */
export default defineAction({
  description:
    "Score an enriched lead for ICP fit (direct LLM call, structured JSON). Records score, reasoning, and token cost on the lead.",
  schema: z.object({
    leadId: z.string().describe("Lead id returned by enrich-lead"),
  }),
  http: { method: "POST" },
  run: async ({ leadId }) => scoreLeadStep(leadId),
});

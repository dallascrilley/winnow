import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { proposeRoutingStep } from "../server/lib/chain.js";

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
  run: async ({ leadId }) => proposeRoutingStep(leadId),
});

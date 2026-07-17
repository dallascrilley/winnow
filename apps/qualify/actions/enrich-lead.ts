import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { enrichLeadStep } from "../server/lib/chain.js";

/**
 * Create (or reload) a lead from an inbound submission and run deterministic
 * synthetic enrichment over it. Idempotent on formResponseId: a retried
 * intake event re-enriches the same lead instead of duplicating it.
 */
export default defineAction({
  description:
    "Create or reload a lead from an inbound submission and enrich it (synthetic firmographics lookup). Idempotent by formResponseId.",
  schema: z
    .object({
      leadId: z.string().optional(),
      formResponseId: z.string().optional(),
      email: z.string().email().optional(),
      name: z.string().optional(),
      companySize: z.string().optional(),
      message: z.string().optional(),
    })
    .refine((v) => v.leadId || v.formResponseId || v.email, {
      message: "leadId, formResponseId, or email is required",
    }),
  http: { method: "POST" },
  run: async (args) => enrichLeadStep(args),
});

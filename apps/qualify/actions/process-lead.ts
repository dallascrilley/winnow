import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  enrichLeadStep,
  proposeRoutingStep,
  scoreLeadStep,
} from "../server/lib/chain.js";
import { appendAudit } from "../server/lib/leads.js";

/**
 * Cross-app intake entry point (called by the forms app with an A2A JWT).
 * Creates/loads the lead synchronously so the caller gets a durable record,
 * then runs enrich → score → propose as a detached continuation so the
 * public form submit stays fast. Requires a long-running host (the U8 ECS
 * deployment) — on serverless the detached work could be frozen.
 */
export default defineAction({
  description:
    "Atomic intake for a form submission: creates the lead now, then runs the full qualification chain (enrich → score → propose) in the background. Idempotent by formResponseId.",
  schema: z.object({
    formResponseId: z.string().min(1),
    email: z.string().email(),
    name: z.string().optional(),
    companySize: z.string().optional(),
    message: z.string().optional(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const { leadId } = await enrichLeadStep(args);
    const leadId_ = leadId;

    void (async () => {
      try {
        await scoreLeadStep(leadId_);
        await proposeRoutingStep(leadId_);
      } catch (error) {
        await appendAudit(leadId_, {
          actor: "system",
          event: "chain-error",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return { leadId, accepted: true };
  },
});

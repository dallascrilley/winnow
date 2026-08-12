import { defineAction } from "@agent-native/core/action";
import { siblingActionFetch } from "@winnow/shared/server";
import { z } from "zod";

import {
  enrichLeadStep,
  proposeRoutingStep,
  scoreLeadStep,
} from "../server/lib/chain.js";
import { trackFunnelEvent } from "../server/lib/funnel-track.js";
import { appendAudit, setLeadStatus } from "../server/lib/leads.js";

/**
 * Cross-app intake entry point (called by the forms app with an A2A JWT).
 * Creates/loads the lead synchronously so the caller gets a durable record,
 * then runs enrich → score → propose as a detached continuation so the
 * public form submit stays fast. Requires a long-running host (the U8 ECS
 * deployment) — on serverless the detached work could be frozen.
 */
export default defineAction({
  description:
    "Atomic intake for a form submission: creates the lead now, then runs the full qualification chain (enrich → score → propose → auto-route) in the background. Idempotent by formResponseId.",
  schema: z.object({
    formResponseId: z.string().min(1),
    email: z.string().email(),
    name: z.string().optional(),
    companySize: z.string().optional(),
    message: z.string().optional(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const { leadId, terminal } = await enrichLeadStep(args);

    // A terminal lead (routed/booked/disqualified) came back from a retried
    // intake — the chain must not re-run or the status machine rewinds.
    if (!terminal) {
      void (async () => {
        try {
          await scoreLeadStep(leadId);
          const { proposal } = await proposeRoutingStep(leadId);
          if (proposal.band === "auto") {
            // Auto-approved leads route immediately; review-band leads wait
            // for the U5 approval gate.
            const routed = (await siblingActionFetch(
              "scheduler",
              "route-lead",
              {
                method: "POST",
                body: { formResponseId: args.formResponseId },
              },
            )) as {
              route?: {
                hostEmail?: string;
                eventTypeId?: string;
                matchedRuleId?: string;
              };
              idempotent?: boolean;
            };
            if (routed?.route && !routed.idempotent) {
              trackFunnelEvent("lead_routed", args.formResponseId, {
                eventType: routed.route.eventTypeId ?? null,
                rule: routed.route.matchedRuleId ?? null,
              });
            }
          }
        } catch (error) {
          // Keep the state machine honest: a chain that died mid-run (LLM
          // host down, route-lead throw) must not strand the lead in-flight.
          await setLeadStatus(leadId, "chain_failed");
          await appendAudit(leadId, {
            actor: "system",
            event: "chain-error",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }

    return { leadId, accepted: true };
  },
});

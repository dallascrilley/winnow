import { defineAction } from "@agent-native/core/action";
import { siblingActionFetch } from "@inbound/shared/server";
import { z } from "zod";

import {
  appendAudit,
  getLeadOrThrow,
  setLeadStatus,
} from "../server/lib/leads.js";

/**
 * The HITL decision callback. A human (in-app queue, or Slack via dispatch
 * once the sandbox is wired) approves or rejects a pending_approval lead.
 * Approve → hand to scheduler route-lead; reject → disqualify with the
 * reviewer's note. Every decision lands on the lead's public audit timeline
 * with actor "human" and the channel it came from.
 */
export default defineAction({
  description:
    "Record a human approval decision for a pending_approval lead (approve → route, reject → disqualify).",
  schema: z.object({
    leadId: z.string(),
    decision: z.enum(["approve", "reject"]),
    channel: z.string().optional().default("app"),
    note: z.string().optional(),
  }),
  http: { method: "POST" },
  run: async ({ leadId, decision, channel, note }) => {
    const lead = await getLeadOrThrow(leadId);
    if (lead.status !== "pending_approval") {
      throw new Error(
        `lead ${leadId} is "${lead.status}" — only pending_approval leads can be decided`,
      );
    }

    if (decision === "reject") {
      await setLeadStatus(leadId, "disqualified");
      await appendAudit(leadId, {
        actor: "human",
        channel,
        event: "rejected",
        detail: note ?? "rejected by reviewer",
      });
      return { leadId, status: "disqualified" };
    }

    await setLeadStatus(leadId, "approved");
    await appendAudit(leadId, {
      actor: "human",
      channel,
      event: "approved",
      detail: note ?? "approved by reviewer",
    });

    const route = await siblingActionFetch("scheduler", "route-lead", {
      method: "POST",
      body: { formResponseId: lead.formResponseId },
    });

    return { leadId, status: "approved", route };
  },
});

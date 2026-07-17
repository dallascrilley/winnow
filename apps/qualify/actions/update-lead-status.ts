import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { LEAD_STATUSES } from "../server/db/schema.js";
import { trackFunnelEvent } from "../server/lib/funnel-track.js";
import {
  appendAudit,
  getLeadOrThrow,
  setLeadStatus,
} from "../server/lib/leads.js";

/**
 * Guarded status transition with an audit entry. The U5 approval callback
 * uses this to record the human's decision (actor "human", channel "slack").
 */
export default defineAction({
  description:
    "Move a lead to a new status with an audit-timeline entry (used by the approval gate).",
  schema: z.object({
    leadId: z.string(),
    status: z.enum(LEAD_STATUSES),
    actor: z.enum(["agent", "human", "system"]).optional().default("agent"),
    channel: z.string().optional(),
    detail: z.string().optional(),
  }),
  http: { method: "POST" },
  run: async ({ leadId, status, actor, channel, detail }) => {
    const lead = await getLeadOrThrow(leadId);
    await setLeadStatus(leadId, status);
    await appendAudit(leadId, {
      actor,
      channel,
      event: `status:${lead.status}→${status}`,
      detail,
    });
    // Only book-lead (scheduler) transitions a lead to booked, so this is the
    // single emission site — the routed event fires caller-side where the
    // structured route payload exists.
    if (status === "booked") {
      trackFunnelEvent("lead_booked", lead.formResponseId ?? leadId, {});
    }
    return { leadId, status };
  },
});

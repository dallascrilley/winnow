import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { siblingActionFetch } from "@inbound/shared/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { evaluateRouting } from "../server/lib/routing-evaluator.js";
import { ROUTING_FORM_ID } from "../server/seed/team.js";
import assignRoundRobinHost from "./assign-round-robin-host.js";

interface QualifyLeadStatus {
  found: boolean;
  lead?: {
    id: string;
    status: string;
    segment: string | null;
  };
}

/**
 * Route an approved lead: evaluate the routing form over its qualification
 * segment, round-robin the event type's host pool, persist the decision in
 * lead_routes, and mark the lead routed back in qualify. Idempotent by
 * formResponseId. Called by qualify's auto-chain and by the U5 approval
 * callback — not part of the anonymous surface.
 */
export default defineAction({
  description:
    "Route an approved lead (routing form evaluation + round-robin host) and report it back to qualify. Idempotent by formResponseId.",
  schema: z.object({
    formResponseId: z.string().min(1),
  }),
  http: { method: "POST" },
  run: async ({ formResponseId }) => {
    const db = getDb();

    const existing = await db
      .select()
      .from(schema.leadRoutes)
      .where(eq(schema.leadRoutes.formResponseId, formResponseId))
      .limit(1);
    if (existing[0]) {
      return {
        formResponseId,
        route: existing[0],
        bookingPath: `/scheduler/book/${formResponseId}`,
        idempotent: true,
      };
    }

    const { found, lead } = await siblingActionFetch<QualifyLeadStatus>(
      "qualify",
      "get-lead-status",
      { method: "GET", body: { responseId: formResponseId } },
    );
    if (!found || !lead) {
      throw new Error(`no qualify lead for form response ${formResponseId}`);
    }
    if (lead.status !== "approved") {
      throw new Error(
        `lead ${formResponseId} is "${lead.status}" — routing requires "approved"`,
      );
    }

    const rfRows = await db
      .select()
      .from(schema.routingForms)
      .where(eq(schema.routingForms.id, ROUTING_FORM_ID))
      .limit(1);
    const rf = rfRows[0];
    if (!rf) {
      throw new Error(
        `routing form ${ROUTING_FORM_ID} missing — run pnpm seed`,
      );
    }

    const { matchedRuleId, action } = evaluateRouting(
      JSON.parse(rf.rules ?? "[]"),
      JSON.parse(rf.fallback ?? "null"),
      { segment: lead.segment ?? "unknown" },
    );
    if (action.kind !== "event-type") {
      throw new Error(`routing produced non-bookable action: ${action.kind}`);
    }

    const { hostEmail } = (await assignRoundRobinHost.run({
      eventTypeId: action.eventTypeId,
    })) as { hostEmail: string };

    const now = new Date().toISOString();
    await db.insert(schema.leadRoutes).values({
      formResponseId,
      qualifyLeadId: lead.id,
      routingFormId: ROUTING_FORM_ID,
      matchedRuleId,
      eventTypeId: action.eventTypeId,
      hostEmail,
      status: "routed",
      createdAt: now,
      updatedAt: now,
    });

    const etRows = await db
      .select({ slug: schema.eventTypes.slug, title: schema.eventTypes.title })
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.id, action.eventTypeId))
      .limit(1);

    await siblingActionFetch("qualify", "update-lead-status", {
      method: "POST",
      body: {
        leadId: lead.id,
        status: "routed",
        actor: "system",
        detail: `routed to ${etRows[0]?.title ?? "event"} with host ${hostEmail} (rule ${matchedRuleId ?? "fallback"})`,
      },
    });

    return {
      formResponseId,
      route: { eventTypeId: action.eventTypeId, hostEmail, matchedRuleId },
      bookingPath: `/scheduler/book/${formResponseId}`,
      idempotent: false,
    };
  },
});

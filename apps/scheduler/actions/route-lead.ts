import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { siblingActionFetch } from "@winnow/shared/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isUniqueViolation } from "../server/lib/is-unique-violation.js";
import { pickRoundRobinHost } from "../server/lib/pick-round-robin-host.js";
import {
  evaluateRouting,
  type RoutingAction,
} from "../server/lib/routing-evaluator.js";
import { ROUTING_FORM_ID } from "../server/seed/team.js";

interface QualifyLeadRoutingContext {
  found: boolean;
  lead?: {
    id: string;
    status: string;
    segment: string | null;
  };
}

type LeadRoute = typeof schema.leadRoutes.$inferSelect;

function idempotentResult(formResponseId: string, route: LeadRoute) {
  if (route.status === "no_route") {
    return {
      formResponseId,
      routed: false as const,
      matchedRuleId: route.matchedRuleId,
      idempotent: true as const,
    };
  }
  return {
    formResponseId,
    route,
    bookingPath: `/scheduler/book/${formResponseId}`,
    idempotent: true as const,
  };
}

/**
 * Route an approved lead: evaluate the routing form over its qualification
 * segment, round-robin the event type's host pool, persist the decision in
 * lead_routes, and mark the lead routed back in qualify. Idempotent by
 * formResponseId. Called by qualify's auto-chain and by the U5 approval
 * callback — not part of the anonymous surface.
 *
 * Rotation is app-side (pick-round-robin-host over lead_routes history): the
 * package metric counts past-30-day bookings, which never sees this app's
 * future-dated bookings and pins every lead to the priority-1 host.
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
      return idempotentResult(formResponseId, existing[0]);
    }

    const { found, lead } = await siblingActionFetch<QualifyLeadRoutingContext>(
      "qualify",
      "get-lead-routing-context",
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

    const fallback = JSON.parse(rf.fallback ?? "null") as RoutingAction | null;
    if (!fallback) {
      throw new Error(
        `routing form ${ROUTING_FORM_ID} has no fallback action — re-run pnpm seed`,
      );
    }
    const { matchedRuleId, action } = evaluateRouting(
      JSON.parse(rf.rules ?? "[]") || [],
      fallback,
      { segment: lead.segment ?? "unknown" },
    );

    const now = new Date().toISOString();
    const base = {
      formResponseId,
      qualifyLeadId: lead.id,
      routingFormId: ROUTING_FORM_ID,
      matchedRuleId,
      createdAt: now,
      updatedAt: now,
    };

    // Returns the winning row when a concurrent route-lead for the same
    // formResponseId beat this insert; null when this insert won.
    const insertRoute = async (
      values: typeof schema.leadRoutes.$inferInsert,
    ): Promise<LeadRoute | null> => {
      try {
        await db.insert(schema.leadRoutes).values(values);
        return null;
      } catch (err) {
        if (isUniqueViolation(err, "lead_routes")) {
          const won = await db
            .select()
            .from(schema.leadRoutes)
            .where(eq(schema.leadRoutes.formResponseId, formResponseId))
            .limit(1);
          if (won[0]) return won[0];
        }
        throw err;
      }
    };

    if (action.kind !== "event-type") {
      // A legit "no route" outcome (e.g. custom-message fallback) is a
      // decision, not an error — persist it so retries stay idempotent.
      const won = await insertRoute({
        ...base,
        eventTypeId: null,
        hostEmail: null,
        status: "no_route",
      });
      if (won) return idempotentResult(formResponseId, won);
      return {
        formResponseId,
        routed: false as const,
        matchedRuleId,
        idempotent: false as const,
      };
    }

    const hostRows = await db
      .select()
      .from(schema.eventTypeHosts)
      .where(eq(schema.eventTypeHosts.eventTypeId, action.eventTypeId));
    const assigned = await db
      .select({ hostEmail: schema.leadRoutes.hostEmail })
      .from(schema.leadRoutes)
      .where(eq(schema.leadRoutes.eventTypeId, action.eventTypeId));
    const counts: Record<string, number> = {};
    for (const row of assigned) {
      if (!row.hostEmail) continue;
      counts[row.hostEmail] = (counts[row.hostEmail] ?? 0) + 1;
    }
    const hostEmail = pickRoundRobinHost(
      hostRows.map((h) => ({
        userEmail: h.userEmail,
        isFixed: Boolean(h.isFixed),
        priority: h.priority,
      })),
      counts,
    );
    if (!hostEmail) {
      throw new Error(
        `no hosts available for event type ${action.eventTypeId}`,
      );
    }

    const won = await insertRoute({
      ...base,
      eventTypeId: action.eventTypeId,
      hostEmail,
      status: "routed",
    });
    if (won) return idempotentResult(formResponseId, won);

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
      idempotent: false as const,
    };
  },
});

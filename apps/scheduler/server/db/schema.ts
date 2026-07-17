import { index, table, text } from "@agent-native/core/db/schema";
import { eventTypes } from "@agent-native/scheduling/schema";

export * from "@agent-native/scheduling/schema";

export const LEAD_ROUTE_STATUSES = ["routed", "booked", "cancelled"] as const;

/**
 * Join table between qualify's leads (keyed by the public formResponseId
 * capability token) and this app's routing decision: which event type the
 * routing form sent them to and which AE round-robin assigned. Persisted by
 * the route-lead action; read anonymously by the public booking page.
 */
export const leadRoutes = table(
  "lead_routes",
  {
    formResponseId: text("form_response_id").primaryKey(),
    qualifyLeadId: text("qualify_lead_id").notNull(),
    routingFormId: text("routing_form_id").notNull(),
    matchedRuleId: text("matched_rule_id"),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id),
    hostEmail: text("host_email").notNull(),
    status: text("status", { enum: LEAD_ROUTE_STATUSES })
      .notNull()
      .default("routed"),
    bookingUid: text("booking_uid"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("lead_routes_qualify_lead_idx").on(t.qualifyLeadId),
  }),
);

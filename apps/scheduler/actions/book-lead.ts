import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import {
  createBooking,
  getEventTypeById,
} from "@agent-native/scheduling/server";
import { siblingActionFetch } from "@inbound/shared/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/**
 * Anonymous booking confirm: creates the booking pinned to the routed host
 * (createBooking takes hostEmail directly — the round-robin decision from
 * route-lead is honored, not re-rolled), then marks the lead booked back in
 * qualify so the status page completes.
 */
export default defineAction({
  description:
    "Book a routed lead into a chosen slot (host-pinned) and report the booking back to qualify.",
  schema: z.object({
    responseId: z.string().min(1),
    startTime: z.string(),
    endTime: z.string(),
    timezone: z.string().default("America/Chicago"),
    attendeeName: z.string().min(1),
    attendeeEmail: z.string().email(),
  }),
  http: { method: "POST" },
  requiresAuth: false,
  run: async ({
    responseId,
    startTime,
    endTime,
    timezone,
    attendeeName,
    attendeeEmail,
  }) => {
    const db = getDb();
    const routes = await db
      .select()
      .from(schema.leadRoutes)
      .where(eq(schema.leadRoutes.formResponseId, responseId))
      .limit(1);
    const route = routes[0];
    if (!route) throw new Error("route not found");
    if (route.status === "booked") {
      return { booked: true, bookingUid: route.bookingUid, idempotent: true };
    }

    const eventType = await getEventTypeById(route.eventTypeId);
    if (!eventType) throw new Error("event type missing");

    const booking = await createBooking({
      eventType,
      hostEmail: route.hostEmail,
      startTime,
      endTime,
      timezone,
      attendee: { name: attendeeName, email: attendeeEmail, timezone },
    });

    await db
      .update(schema.leadRoutes)
      .set({
        status: "booked",
        bookingUid: booking.uid,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.leadRoutes.formResponseId, responseId));

    await siblingActionFetch("qualify", "update-lead-status", {
      method: "POST",
      body: {
        leadId: route.qualifyLeadId,
        status: "booked",
        actor: "system",
        detail: `booked ${startTime} with ${route.hostEmail} (uid ${booking.uid})`,
      },
    });

    return { booked: true, bookingUid: booking.uid, idempotent: false };
  },
});

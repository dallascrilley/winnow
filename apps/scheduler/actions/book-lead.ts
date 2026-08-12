import { defineAction } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import {
  cancelBooking,
  createBooking,
  getAvailableSlots,
  getEventTypeById,
} from "@agent-native/scheduling/server";
import { siblingActionFetch } from "@winnow/shared/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isOfferedSlot } from "../server/lib/is-offered-slot.js";
import { isUniqueViolation } from "../server/lib/is-unique-violation.js";

/**
 * Anonymous booking confirm: creates the booking pinned to the routed host
 * (createBooking takes hostEmail directly — the round-robin decision from
 * route-lead is honored, not re-rolled), then marks the lead booked back in
 * qualify so the status page completes.
 *
 * Concurrency: the lead_routes status flip is conditional (status = 'routed'),
 * so a double-submit loses the race instead of double-booking; the loser
 * cancels its just-created booking and reads back the winner's. The requested
 * interval is re-validated against the host's offered slots — createBooking
 * only checks conflicts, not that the slot was ever offered.
 */
export default defineAction({
  description:
    "Book a routed lead into a chosen slot (host-pinned) and report the booking back to qualify.",
  schema: z.object({
    responseId: z.string().min(1),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
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
    if (route.status !== "routed" || !route.eventTypeId || !route.hostEmail) {
      throw Object.assign(new Error("route is not bookable"), {
        statusCode: 409,
      });
    }

    const eventType = await getEventTypeById(route.eventTypeId);
    if (!eventType) throw new Error("event type missing");

    // Recompute the host's offered slots around the requested day (the same
    // availability path route-slots uses) and require an exact match.
    const startMs = Date.parse(startTime);
    const endMs = Date.parse(endTime);
    const offered = await getAvailableSlots({
      eventType,
      forUserEmail: route.hostEmail,
      rangeStart: new Date(startMs - 24 * 60 * 60 * 1000),
      rangeEnd: new Date(endMs + 24 * 60 * 60 * 1000),
      viewerTimezone: timezone,
    });
    if (!isOfferedSlot(offered, startTime, endTime, eventType.length)) {
      throw Object.assign(new Error("requested time is not an offered slot"), {
        statusCode: 400,
      });
    }

    let booking;
    try {
      booking = await createBooking({
        eventType,
        hostEmail: route.hostEmail,
        startTime,
        endTime,
        timezone,
        attendee: { name: attendeeName, email: attendeeEmail, timezone },
      });
    } catch (err) {
      // Marker matches both dialects: sqlite names the columns
      // ("UNIQUE constraint failed: bookings.host_email, …"), postgres names
      // the index ("… \"bookings_host_email_start_time_confirmed_unique\"").
      if (isUniqueViolation(err, "host_email")) {
        throw Object.assign(new Error("slot just taken — pick another time"), {
          statusCode: 409,
        });
      }
      throw err;
    }

    const flipped = await db
      .update(schema.leadRoutes)
      .set({
        status: "booked",
        bookingUid: booking.uid,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.leadRoutes.formResponseId, responseId),
          eq(schema.leadRoutes.status, "routed"),
        ),
      )
      .returning({ formResponseId: schema.leadRoutes.formResponseId });

    if (flipped.length === 0) {
      // Another submit booked this route first — release the slot we just
      // took, then answer from the winner's row.
      await cancelBooking({
        uid: booking.uid,
        reason: "duplicate booking submit",
        cancelledBy: "attendee",
      }).catch(() => {});
      const current = await db
        .select()
        .from(schema.leadRoutes)
        .where(eq(schema.leadRoutes.formResponseId, responseId))
        .limit(1);
      if (current[0]?.status === "booked") {
        return {
          booked: true,
          bookingUid: current[0].bookingUid,
          idempotent: true,
        };
      }
      throw Object.assign(new Error("route is not bookable"), {
        statusCode: 409,
      });
    }

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

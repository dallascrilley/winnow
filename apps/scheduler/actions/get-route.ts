import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { AES } from "../server/seed/team.js";

/**
 * Anonymous, capability-keyed read for the public booking page (the
 * formResponseId nanoid is the key). Sanitized: event type + host first
 * name, no internal ids beyond what the page needs.
 */
export default defineAction({
  description:
    "Public read of a lead's routing decision by form response id (capability key).",
  schema: z.object({
    responseId: z.string().min(1),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  run: async ({ responseId }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.leadRoutes)
      .where(eq(schema.leadRoutes.formResponseId, responseId))
      .limit(1);
    const route = rows[0];
    if (!route) return { found: false as const };

    const etRows = await db
      .select()
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.id, route.eventTypeId))
      .limit(1);
    const et = etRows[0];
    const ae = AES.find((a) => a.email === route.hostEmail);

    return {
      found: true as const,
      route: {
        status: route.status,
        eventTitle: et?.title ?? "Call",
        eventLength: et?.length ?? 30,
        hostName: ae?.name ?? route.hostEmail.split("@")[0],
        bookingUid: route.bookingUid,
      },
    };
  },
});

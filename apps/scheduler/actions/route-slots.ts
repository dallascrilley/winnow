import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import {
  getAvailableSlots,
  getEventTypeById,
} from "@agent-native/scheduling/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/**
 * Anonymous slot grid for a routed lead's assigned host. Powered by the
 * scheduling package's availability engine with forUserEmail pinned to the
 * round-robin-assigned AE.
 */
export default defineAction({
  description:
    "Public slot grid for a routed lead (host-pinned availability) by form response id.",
  schema: z.object({
    responseId: z.string().min(1),
    from: z.string().datetime(),
    to: z.string().datetime(),
    timezone: z.string().optional(),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  run: async ({ responseId, from, to, timezone }) => {
    const db = getDb();
    const routes = await db
      .select()
      .from(schema.leadRoutes)
      .where(eq(schema.leadRoutes.formResponseId, responseId))
      .limit(1);
    const route = routes[0];
    if (!route) throw new Error("route not found");
    if (route.status !== "routed" || !route.eventTypeId || !route.hostEmail) {
      return { slots: [] };
    }

    const eventType = await getEventTypeById(route.eventTypeId);
    if (!eventType) throw new Error("event type missing");

    const slots = await getAvailableSlots({
      eventType,
      forUserEmail: route.hostEmail,
      rangeStart: new Date(from),
      rangeEnd: new Date(to),
      viewerTimezone: timezone,
    });

    return { slots };
  },
});

import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/**
 * Auth-gated sibling read for scheduler route-lead / booking prefill.
 * Not public — carries internal lead id + contact fields A2A callers need
 * after public get-lead-status stopped exposing them.
 */
export default defineAction({
  description:
    "Fetch lead id/status/segment/name/email by form response id for cross-app routing (A2A, not public).",
  schema: z.object({
    responseId: z.string().min(1),
  }),
  http: { method: "GET" },
  run: async ({ responseId }) => {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.leads.id,
        status: schema.leads.status,
        segment: schema.leads.segment,
        name: schema.leads.name,
        email: schema.leads.email,
      })
      .from(schema.leads)
      .where(eq(schema.leads.formResponseId, responseId))
      .limit(1);
    const lead = rows[0];
    if (!lead) return { found: false as const };
    return { found: true as const, lead };
  },
});

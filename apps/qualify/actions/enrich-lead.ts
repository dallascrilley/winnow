import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { enrich } from "../server/lib/enrichment.js";
import {
  appendAudit,
  currentOwnerEmail,
  getLeadOrThrow,
  newLeadId,
  newStatusToken,
  setLeadStatus,
} from "../server/lib/leads.js";

/**
 * Create (or reload) a lead from an inbound submission and run deterministic
 * synthetic enrichment over it. Idempotent on formResponseId: a retried
 * intake event re-enriches the same lead instead of duplicating it.
 */
export default defineAction({
  description:
    "Create or reload a lead from an inbound submission and enrich it (synthetic firmographics lookup). Idempotent by formResponseId.",
  schema: z
    .object({
      leadId: z.string().optional(),
      formResponseId: z.string().optional(),
      email: z.string().email().optional(),
      name: z.string().optional(),
      companySize: z.string().optional(),
      message: z.string().optional(),
    })
    .refine((v) => v.leadId || v.formResponseId || v.email, {
      message: "leadId, formResponseId, or email is required",
    }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();

    let leadId = args.leadId;
    if (!leadId && args.formResponseId) {
      const existing = await db
        .select({ id: schema.leads.id })
        .from(schema.leads)
        .where(eq(schema.leads.formResponseId, args.formResponseId))
        .limit(1);
      leadId = existing[0]?.id;
    }

    if (!leadId) {
      leadId = newLeadId();
      const now = new Date().toISOString();
      await db.insert(schema.leads).values({
        id: leadId,
        formResponseId: args.formResponseId ?? null,
        email: args.email!,
        name: args.name ?? null,
        companySize: args.companySize ?? null,
        message: args.message ?? null,
        status: "enriching",
        statusToken: newStatusToken(),
        createdAt: now,
        updatedAt: now,
        ownerEmail: currentOwnerEmail(),
      });
      await appendAudit(
        leadId,
        {
          actor: "system",
          event: "lead-created",
          detail: "inbound submission received",
        },
        db,
      );
    } else {
      const existing = await getLeadOrThrow(leadId, db);
      // Re-enrichment refreshes the profile but must not rewind a lead that
      // has already progressed (e.g. pending_approval mid-gate in U5).
      if (existing.status === "new") {
        await setLeadStatus(leadId, "enriching", db);
      }
    }

    const lead = await getLeadOrThrow(leadId, db);
    const profile = await enrich(
      {
        email: lead.email,
        companySize: lead.companySize,
        message: lead.message,
      },
      db,
    );

    await db
      .update(schema.leads)
      .set({
        enrichment: JSON.stringify(profile),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.leads.id, leadId));

    await appendAudit(
      leadId,
      {
        actor: "agent",
        event: "enriched",
        detail: profile.matched
          ? `matched ${profile.companyName} (${profile.industry}, ${profile.employees} employees)`
          : profile.notes.join("; "),
      },
      db,
    );

    return { leadId, profile };
  },
});

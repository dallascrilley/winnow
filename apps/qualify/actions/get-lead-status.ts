import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { issueJourneyToken } from "../server/lib/journey-token.js";
import { parseAudit } from "../server/lib/leads.js";

const PUBLIC_AUDIT_EVENTS: Record<string, string> = {
  "lead-created": "Request received",
  enriched: "Company researched",
  scored: "Fit assessed",
  "routing-proposed": "Routing prepared",
  approved: "Approved",
  rejected: "Reviewed",
};

function publicAudit(raw: string | null) {
  return parseAudit(raw).flatMap((entry) => {
    if (typeof entry.at !== "string") return [];
    return [
      {
        at: entry.at,
        actor:
          entry.actor === "agent" || entry.actor === "human"
            ? entry.actor
            : "system",
        event: PUBLIC_AUDIT_EVENTS[entry.event] ?? "Status updated",
      },
    ];
  });
}

function publicProposal(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const { eventTypeSlug } = parsed as { eventTypeSlug?: unknown };
    return eventTypeSlug === "discovery" || eventTypeSlug === "deep-dive"
      ? { eventTypeSlug }
      : null;
  } catch {
    return null;
  }
}

/**
 * Anonymous, capability-keyed read for the public status page. The forms
 * response id (a nanoid the submitter receives via redirect) is the lookup
 * key — unguessable, so no session is required. The response contains only
 * visitor-facing status fields, a projected event type, and a fixed-shape
 * audit timeline. It never returns raw audit details, parsed internal JSON,
 * ownership/contact data, or operator telemetry. Issues a short-lived opaque
 * journeyToken for cross-app funnel highlight.
 *
 * Registered in server/plugins/auth.ts publicPaths.
 */
export default defineAction({
  description:
    "Public read of a lead's qualification status by form response id (capability key, sanitized projection + journey token).",
  schema: z.object({
    responseId: z.string().min(1),
    /** Query flag from status page; only the string "true" mints a token. */
    issueJourney: z.string().optional(),
  }),
  run: async ({ responseId, issueJourney: issueJourneyRaw }) => {
    const db = getDb();
    // Keep this query aligned with the public response below. In particular,
    // never load internal ownership, contact, or LLM telemetry fields here.
    const rows = await db
      .select({
        status: schema.leads.status,
        name: schema.leads.name,
        fitScore: schema.leads.fitScore,
        tier: schema.leads.tier,
        segment: schema.leads.segment,
        proposal: schema.leads.proposal,
        audit: schema.leads.audit,
        createdAt: schema.leads.createdAt,
      })
      .from(schema.leads)
      .where(eq(schema.leads.formResponseId, responseId))
      .limit(1);
    const lead = rows[0];

    if (!lead) {
      // The async A2A handoff may not have created the lead yet — the status
      // page keeps polling and shows "waiting for pickup" meanwhile.
      return { found: false as const };
    }

    let journeyToken: string | null = null;
    if (issueJourneyRaw === "true") {
      try {
        // Always mint a fresh opaque token for this page load (multiple
        // concurrent hashes per formResponseId are fine; resolve is by hash).
        journeyToken = await issueJourneyToken(responseId, undefined, {
          force: true,
        });
      } catch {
        journeyToken = null;
      }
    }
    return {
      found: true as const,
      lead: {
        status: lead.status,
        name: lead.name,
        fitScore: lead.fitScore,
        tier: lead.tier,
        segment: lead.segment,
        proposal: publicProposal(lead.proposal),
        audit: publicAudit(lead.audit),
        createdAt: lead.createdAt,
        journeyToken,
      },
    };
  },
});

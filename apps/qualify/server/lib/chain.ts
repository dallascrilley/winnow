import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";
import { enrich } from "./enrichment.js";
import { trackFunnelEvent } from "./funnel-track.js";
import {
  appendAudit,
  currentOwnerEmail,
  getLeadOrThrow,
  loadIcp,
  newLeadId,
  newStatusToken,
  setLeadStatus,
} from "./leads.js";
import { proposalFor, scoreIcp } from "./scoring.js";

/**
 * The qualification chain as three composable steps — called individually by
 * the enrich-lead / score-icp / propose-routing actions, and end-to-end by
 * process-lead (the cross-app intake entry point).
 */

export interface EnrichLeadInput {
  leadId?: string;
  formResponseId?: string;
  email?: string;
  name?: string;
  companySize?: string;
  message?: string;
}

// Statuses where automation has nothing left to do — a retried intake for
// one of these must not rewind the lead or re-fire the chain's side effects.
const AUTOMATION_TERMINAL = new Set(["routed", "booked", "disqualified"]);

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return (
    e?.code === "23505" || /unique constraint failed/i.test(e?.message ?? "")
  );
}

export async function enrichLeadStep(
  args: EnrichLeadInput,
): Promise<{ leadId: string; profile: unknown; terminal?: boolean }> {
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

  let created = false;
  if (!leadId) {
    if (!args.email) {
      throw Object.assign(
        new Error("email is required when creating a new lead"),
        { statusCode: 400 },
      );
    }
    const candidateId = newLeadId();
    const now = new Date().toISOString();
    try {
      await db.insert(schema.leads).values({
        id: candidateId,
        formResponseId: args.formResponseId ?? null,
        email: args.email,
        name: args.name ?? null,
        companySize: args.companySize ?? null,
        message: args.message ?? null,
        status: "enriching",
        statusToken: newStatusToken(),
        createdAt: now,
        updatedAt: now,
        ownerEmail: currentOwnerEmail(),
      });
      leadId = candidateId;
      created = true;
    } catch (error) {
      // Lost the check-then-insert race: a concurrent intake already created
      // this formResponseId's lead — reload it and continue as a retry.
      if (!args.formResponseId || !isUniqueViolation(error)) throw error;
      const raced = await db
        .select({ id: schema.leads.id })
        .from(schema.leads)
        .where(eq(schema.leads.formResponseId, args.formResponseId))
        .limit(1);
      if (!raced[0]) throw error;
      leadId = raced[0].id;
    }
  }

  if (created) {
    await appendAudit(
      leadId,
      {
        actor: "system",
        event: "lead-created",
        detail: "inbound submission received",
      },
      db,
    );
    trackFunnelEvent("lead_submitted", args.formResponseId ?? leadId, {
      source: args.formResponseId ? "talk-to-sales" : "direct",
    });
  }

  // Funnel events fire only when this run actually moved the lead forward —
  // re-running a step over an already-progressed lead must not double-count.
  let transitioned = created;

  if (!created) {
    const existing = await getLeadOrThrow(leadId, db);
    if (AUTOMATION_TERMINAL.has(existing.status)) {
      return {
        leadId,
        profile: existing.enrichment ? JSON.parse(existing.enrichment) : null,
        terminal: true,
      };
    }
    // Re-enrichment refreshes the profile but must not rewind a lead that
    // has already progressed (e.g. pending_approval mid-gate in U5).
    if (existing.status === "new") {
      await setLeadStatus(leadId, "enriching", db);
      transitioned = true;
    }
  }

  const lead = await getLeadOrThrow(leadId, db);
  const profile = await enrich(
    { email: lead.email, companySize: lead.companySize, message: lead.message },
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
  if (transitioned) {
    trackFunnelEvent("lead_enriched", lead.formResponseId ?? leadId, {
      matched: profile.matched,
      industry: profile.matched ? profile.industry : null,
    });
  }

  return { leadId, profile };
}

export async function scoreLeadStep(leadId: string) {
  const db = getDb();
  const lead = await getLeadOrThrow(leadId, db);
  if (!lead.enrichment) {
    throw new Error(`lead ${leadId} is not enriched yet — run enrich first`);
  }

  const icp = await loadIcp(db);
  const { score, usage } = await scoreIcp(icp, {
    profile: JSON.parse(lead.enrichment),
    name: lead.name,
    companySize: lead.companySize,
    message: lead.message,
  });

  await db
    .update(schema.leads)
    .set({
      fitScore: score.fitScore,
      tier: score.tier,
      segment: score.segment,
      scoreReasoning: score.reasoning,
      llmPromptTokens: lead.llmPromptTokens + usage.promptTokens,
      llmCompletionTokens: lead.llmCompletionTokens + usage.completionTokens,
      llmCostUsd: lead.llmCostUsd + usage.costUsd,
      llmModel: usage.model,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.leads.id, leadId));

  // Only a forward move into "scored" re-marks status and re-emits — a
  // re-run over an already-decided lead updates the numbers but must not
  // rewind the state machine or double-count the funnel stage.
  const advanced =
    lead.status === "new" ||
    lead.status === "enriching" ||
    lead.status === "chain_failed";
  if (advanced) {
    await setLeadStatus(leadId, "scored", db);
  }
  await appendAudit(
    leadId,
    {
      actor: "agent",
      event: "scored",
      detail: `fit ${score.fitScore.toFixed(2)} (${score.tier}, ${score.segment}) — ${score.reasoning} [${usage.model}, $${usage.costUsd.toFixed(5)}]`,
    },
    db,
  );
  if (advanced) {
    trackFunnelEvent("lead_scored", lead.formResponseId ?? leadId, {
      fitScore: score.fitScore,
      tier: score.tier,
      segment: score.segment,
      model: usage.model,
      costUsd: usage.costUsd,
    });
  }

  return { leadId, score, usage };
}

export async function proposeRoutingStep(leadId: string) {
  const db = getDb();
  const lead = await getLeadOrThrow(leadId, db);
  if (lead.fitScore === null || !lead.tier || !lead.segment) {
    throw new Error(`lead ${leadId} is not scored yet — run scoring first`);
  }

  const proposal = proposalFor({
    fitScore: lead.fitScore,
    tier: lead.tier,
    segment: lead.segment,
    reasoning: lead.scoreReasoning ?? "",
  });

  // A lead that already finished automation keeps its terminal status —
  // recomputing a proposal must never rewind routed/booked/disqualified.
  if (AUTOMATION_TERMINAL.has(lead.status)) {
    return { leadId, proposal, status: lead.status };
  }

  const status =
    proposal.band === "auto"
      ? "approved"
      : proposal.band === "review"
        ? "pending_approval"
        : "disqualified";
  const transitioned = status !== lead.status;

  await db
    .update(schema.leads)
    .set({
      proposal: JSON.stringify(proposal),
      status,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.leads.id, leadId));

  await appendAudit(
    leadId,
    { actor: "system", event: "routing-proposed", detail: proposal.reason },
    db,
  );
  if (transitioned) {
    trackFunnelEvent("lead_routing_proposed", lead.formResponseId ?? leadId, {
      band: proposal.band,
    });
    if (proposal.band === "disqualify") {
      trackFunnelEvent("lead_disqualified", lead.formResponseId ?? leadId, {
        reason: "low-fit",
      });
    }
  }

  return { leadId, proposal, status };
}

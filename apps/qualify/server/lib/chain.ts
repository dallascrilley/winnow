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

export async function enrichLeadStep(
  args: EnrichLeadInput,
): Promise<{ leadId: string; profile: unknown }> {
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
    trackFunnelEvent("lead_submitted", args.formResponseId ?? leadId, {
      source: args.formResponseId ? "talk-to-sales" : "direct",
    });
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
  trackFunnelEvent("lead_enriched", lead.formResponseId ?? leadId, {
    matched: profile.matched,
    industry: profile.matched ? profile.industry : null,
  });

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

  await setLeadStatus(leadId, "scored", db);
  await appendAudit(
    leadId,
    {
      actor: "agent",
      event: "scored",
      detail: `fit ${score.fitScore.toFixed(2)} (${score.tier}, ${score.segment}) — ${score.reasoning} [${usage.model}, $${usage.costUsd.toFixed(5)}]`,
    },
    db,
  );
  trackFunnelEvent("lead_scored", lead.formResponseId ?? leadId, {
    fitScore: score.fitScore,
    tier: score.tier,
    segment: score.segment,
    model: usage.model,
    costUsd: usage.costUsd,
  });

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

  const status =
    proposal.band === "auto"
      ? "approved"
      : proposal.band === "review"
        ? "pending_approval"
        : "disqualified";

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
  trackFunnelEvent("lead_routing_proposed", lead.formResponseId ?? leadId, {
    band: proposal.band,
  });
  if (proposal.band === "disqualify") {
    trackFunnelEvent("lead_disqualified", lead.formResponseId ?? leadId, {
      reason: "low-fit",
    });
  }

  return { leadId, proposal, status };
}

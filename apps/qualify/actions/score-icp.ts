import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  appendAudit,
  getLeadOrThrow,
  loadIcp,
  setLeadStatus,
} from "../server/lib/leads.js";
import { scoreIcp } from "../server/lib/scoring.js";

/**
 * Score an enriched lead against the ICP definition with a direct OpenAI
 * call. Writes the score, tier, segment, reasoning, and the token-cost
 * ledger onto the lead, then marks it "scored".
 */
export default defineAction({
  description:
    "Score an enriched lead for ICP fit (direct OpenAI call, structured JSON). Records score, reasoning, and token cost on the lead.",
  schema: z.object({
    leadId: z.string().describe("Lead id returned by enrich-lead"),
  }),
  http: { method: "POST" },
  run: async ({ leadId }) => {
    const db = getDb();
    const lead = await getLeadOrThrow(leadId, db);
    if (!lead.enrichment) {
      throw new Error(
        `lead ${leadId} is not enriched yet — run enrich-lead first`,
      );
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

    return { leadId, score, usage };
  },
});

import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";
import {
  buildProfile,
  extractDomain,
  FREE_EMAIL_DOMAINS,
  type EnrichmentInput,
  type EnrichmentProfile,
} from "./enrichment-core.js";

/**
 * Synthetic enrichment — the demo's honest stand-in for the production
 * EnrichCRM path (Brave Search + Trafilatura + Gemini). Deterministic seeded
 * firmographics lookup; unknown domains are flagged `unverified`, never
 * fabricated. Pure logic lives in enrichment-core.ts.
 */

export type { EnrichmentInput, EnrichmentProfile };

export async function enrich(
  input: EnrichmentInput,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<EnrichmentProfile> {
  const domain = extractDomain(input.email);
  const rows = FREE_EMAIL_DOMAINS.has(domain)
    ? []
    : await db
        .select()
        .from(schema.firmographics)
        .where(eq(schema.firmographics.domain, domain))
        .limit(1);
  return buildProfile(domain, rows[0]);
}

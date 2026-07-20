import { createHash, randomBytes } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";

/** Demo-session TTL for cross-app funnel highlight tokens. */
export const JOURNEY_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export function hashJourneyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintJourneyTokenValue(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Issue a fresh opaque journey token for a form response capability.
 * Stores only sha256(token); client receives the raw token once.
 * If an unexpired token already exists for this formResponseId, returns null
 * so pollers do not thrash the table (client keeps the first token it saw).
 */
export async function issueJourneyToken(
  formResponseId: string,
  ttlMs: number = JOURNEY_TOKEN_TTL_MS,
  opts?: { force?: boolean },
): Promise<string | null> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  if (!opts?.force) {
    const existing = await db
      .select({
        tokenHash: schema.journeyTokens.tokenHash,
        exp: schema.journeyTokens.exp,
      })
      .from(schema.journeyTokens)
      .where(eq(schema.journeyTokens.formResponseId, formResponseId))
      .limit(5);
    if (existing.some((row) => row.exp > nowIso)) return null;
  }

  const token = mintJourneyTokenValue();
  const tokenHash = hashJourneyToken(token);
  const now = Date.now();
  const exp = new Date(now + ttlMs).toISOString();
  const createdAt = new Date(now).toISOString();
  await db.insert(schema.journeyTokens).values({
    tokenHash,
    formResponseId,
    exp,
    createdAt,
  });
  return token;
}

/** Resolve a live token to formResponseId, or null if unknown/expired. */
export async function resolveJourneyToken(
  token: string,
): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const tokenHash = hashJourneyToken(token);
  const now = new Date().toISOString();
  const db = getDb();
  const rows = await db
    .select({
      formResponseId: schema.journeyTokens.formResponseId,
      exp: schema.journeyTokens.exp,
    })
    .from(schema.journeyTokens)
    .where(eq(schema.journeyTokens.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row || row.exp <= now) return null;
  return row.formResponseId;
}

/** Map lead status → funnel stage label used by get-public-funnel. */
export function stageLabelForLeadStatus(status: string): string | null {
  switch (status) {
    case "new":
    case "enriching":
      return "submitted";
    case "scored":
    case "pending_approval":
    case "disqualified":
    case "approved":
      return "scored";
    case "routed":
      return "routed";
    case "booked":
      return "booked";
    default:
      return null;
  }
}

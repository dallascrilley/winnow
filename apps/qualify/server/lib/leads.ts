import { randomUUID } from "node:crypto";

import { desc, eq } from "@agent-native/core/db/schema";
import { getRequestUserEmail } from "@agent-native/core/server";

import { getDb, schema } from "../db/index.js";
import type { LeadStatus } from "../db/schema.js";

export interface AuditEntry {
  at: string;
  actor: "agent" | "human" | "system";
  event: string;
  detail?: string;
  channel?: string;
}

export const ICP_SETTING_KEY = "icp_definition";

export const DEFAULT_ICP =
  "Mid-market B2B companies (50-500 employees) with a sales or revenue operations function, especially SaaS, professional services, and agencies. Strong fit: RevOps/GTM/sales leaders evaluating agent-native tooling for inbound routing, CRM hygiene, or lead-to-cash automation. Enterprise (500+) is a strong fit when the message references sales operations or inbound scale. Weak fit: consumers, students, businesses under 10 employees, non-commercial inquiries, vendors pitching us.";

export function currentOwnerEmail(): string {
  return (
    getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL ?? "dev@local.test"
  );
}

export async function loadIcp(
  db: ReturnType<typeof getDb> = getDb(),
): Promise<string> {
  const rows = await db
    .select()
    .from(schema.qualifySettings)
    .where(eq(schema.qualifySettings.key, ICP_SETTING_KEY))
    .limit(1);
  return rows[0]?.value ?? DEFAULT_ICP;
}

export function parseAudit(raw: string | null): AuditEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendAudit(
  leadId: string,
  entry: Omit<AuditEntry, "at">,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<void> {
  const rows = await db
    .select({ audit: schema.leads.audit })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);
  const audit = parseAudit(rows[0]?.audit ?? null);
  audit.push({ ...entry, at: new Date().toISOString() });
  await db
    .update(schema.leads)
    .set({ audit: JSON.stringify(audit), updatedAt: new Date().toISOString() })
    .where(eq(schema.leads.id, leadId));
}

export async function setLeadStatus(
  leadId: string,
  status: LeadStatus,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<void> {
  await db
    .update(schema.leads)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(schema.leads.id, leadId));
}

export async function getLeadOrThrow(
  leadId: string,
  db: ReturnType<typeof getDb> = getDb(),
) {
  const rows = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);
  if (!rows[0]) throw new Error(`lead not found: ${leadId}`);
  return rows[0];
}

export async function listRecentLeads(
  limit = 25,
  db: ReturnType<typeof getDb> = getDb(),
) {
  return db
    .select()
    .from(schema.leads)
    .orderBy(desc(schema.leads.createdAt))
    .limit(limit);
}

export function newLeadId(): string {
  return `lead_${randomUUID()}`;
}

export function newStatusToken(): string {
  return randomUUID();
}

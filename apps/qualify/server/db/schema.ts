import {
  index,
  integer,
  ownableColumns,
  real,
  table,
  text,
} from "@agent-native/core/db/schema";

export const LEAD_STATUSES = [
  "new",
  "enriching",
  "scored",
  "pending_approval",
  "approved",
  "routed",
  "booked",
  "disqualified",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const leads = table(
  "leads",
  {
    id: text("id").primaryKey(),
    // Idempotence key: the forms app's response id. Unique so a retried
    // intake event re-enriches the same lead instead of duplicating it.
    formResponseId: text("form_response_id"),
    email: text("email").notNull(),
    name: text("name"),
    companySize: text("company_size"),
    message: text("message"),
    status: text("status", { enum: LEAD_STATUSES }).notNull().default("new"),
    // Unguessable read key for the public status page (U3). Not a session.
    statusToken: text("status_token").notNull().unique(),
    // JSON EnrichmentProfile from server/lib/enrichment.ts
    enrichment: text("enrichment"),
    fitScore: real("fit_score"),
    tier: text("tier", { enum: ["high", "medium", "low"] }),
    segment: text("segment", {
      enum: ["smb", "midmarket", "enterprise", "personal", "unknown"],
    }),
    scoreReasoning: text("score_reasoning"),
    // JSON RoutingProposal from server/lib/scoring.ts (band policy output)
    proposal: text("proposal"),
    llmPromptTokens: integer("llm_prompt_tokens").notNull().default(0),
    llmCompletionTokens: integer("llm_completion_tokens").notNull().default(0),
    llmCostUsd: real("llm_cost_usd").notNull().default(0),
    llmModel: text("llm_model"),
    // JSON AuditEntry[] — append-only timeline rendered by the status page
    audit: text("audit").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => ({
    emailIdx: index("leads_email_idx").on(t.email),
    statusIdx: index("leads_status_idx").on(t.status),
    formResponseIdx: index("leads_form_response_idx").on(t.formResponseId),
  }),
);

// Synthetic stand-in for production enrichment providers (Brave/Trafilatura/
// Gemini in EnrichCRM). Seeded by `pnpm --filter qualify seed`.
export const firmographics = table("firmographics", {
  domain: text("domain").primaryKey(),
  companyName: text("company_name").notNull(),
  industry: text("industry").notNull(),
  employees: integer("employees").notNull(),
  revenueBand: text("revenue_band").notNull(),
  hq: text("hq").notNull(),
});

// Golden scenarios for the eval suite (U6). Seeded, never produced by traffic.
export const evalCases = table("eval_cases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // JSON { email, name?, companySize?, message? }
  input: text("input").notNull(),
  expectedTier: text("expected_tier", {
    enum: ["high", "medium", "low"],
  }).notNull(),
  expectedSegment: text("expected_segment", {
    enum: ["smb", "midmarket", "enterprise", "personal", "unknown"],
  }).notNull(),
  expectedShouldRoute: integer("expected_should_route", {
    mode: "boolean",
  }).notNull(),
  // JSON string[] — e.g. ["obvious-fit"], ["adversarial","free-email"]
  tags: text("tags").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const evalRuns = table("eval_runs", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  // Hash of the ICP definition + prompt template, so a score change is
  // attributable to a specific prompt/model pairing (the visible gate, U6).
  promptHash: text("prompt_hash").notNull(),
  caseCount: integer("case_count").notNull(),
  passCount: integer("pass_count").notNull(),
  accuracy: real("accuracy").notNull(),
  totalCostUsd: real("total_cost_usd").notNull(),
  // JSON per-case results [{ caseId, tier, segment, shouldRoute, pass }]
  results: text("results").notNull(),
  createdAt: text("created_at").notNull(),
});

// Single-row key-value store for app config (the ICP definition lives here
// so U6 can prove the eval gate moves when it changes).
export const qualifySettings = table("qualify_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

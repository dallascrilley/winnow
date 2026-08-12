/**
 * CLI for the 24-case golden eval suite.
 *
 * Modes:
 *   offline (default, CI) — no LLM, no app DB. Validates suite shape, band
 *     policy consistency, enrichment over seeded firmographics, prompt hashing,
 *     and comparison/summarize plumbing. Exit 1 on any failure.
 *   live — seeds SQLite (or DATABASE_URL) and runs the full enrich→score path
 *     via runEval() against Ollama/OpenAI. Requires a reachable model.
 *
 * Usage:
 *   pnpm eval                 # offline
 *   pnpm eval -- --live       # live LLM
 *   pnpm --filter qualify eval
 */
import { createHash } from "node:crypto";
import process from "node:process";

import {
  buildProfile,
  extractDomain,
  FREE_EMAIL_DOMAINS,
} from "../server/lib/enrichment-core.js";
import {
  compareCase,
  promptHashFor,
  runIdFor,
  summarize,
  type CaseResult,
} from "../server/lib/eval-core.js";
import {
  bandForScore,
  buildPrompt,
  PROMPT_RULES,
  SYSTEM_PROMPT,
  type Segment,
  type Tier,
} from "../server/lib/scoring.js";
import { EVAL_CASES } from "../server/seed/eval-cases.js";
import { generateFirmographics } from "../server/seed/firmographics.js";

const REQUIRED_CASE_COUNT = 24;
const REQUIRED_TAG_GROUPS = ["obvious-fit", "mid", "poor-fit", "adversarial"] as const;

// Mirrors DEFAULT_ICP in leads.ts without importing the core DB chain.
const DEFAULT_ICP =
  "Mid-market B2B companies (50-500 employees) with a sales or revenue operations function, especially SaaS, professional services, and agencies. Strong fit: RevOps/GTM/sales leaders evaluating agent-native tooling for inbound routing, CRM hygiene, or lead-to-cash automation. Enterprise (500+) is a strong fit when the message references sales operations or inbound scale. Weak fit: consumers, students, businesses under 10 employees, non-commercial inquiries, vendors pitching us.";

const SENTINEL_SCORE_INPUT = {
  profile: {
    domain: "sentinel.example",
    matched: true,
    personal: false,
    companyName: "Sentinel Co",
    industry: "Software",
    industryGuessed: false,
    employees: 120,
    revenueBand: "$10M-$50M",
    hq: "Austin, TX",
    unverified: false,
    notes: [] as string[],
  },
  name: "Sam Sentinel",
  companySize: "51-200",
  message: "sentinel input for the eval prompt hash",
};

type Failure = { caseId?: string; message: string };

function fail(failures: Failure[], message: string, caseId?: string) {
  failures.push({ caseId, message });
}

function tierRouteConsistent(tier: Tier, shouldRoute: boolean): boolean {
  // Band policy: high (>=0.8) auto-routes; medium/low never do.
  if (tier === "high") return shouldRoute === true;
  return shouldRoute === false;
}

function enrichOffline(email: string) {
  const domain = extractDomain(email);
  const firmographics = generateFirmographics();
  const hit = FREE_EMAIL_DOMAINS.has(domain)
    ? undefined
    : firmographics.find((r) => r.domain === domain);
  return buildProfile(
    domain,
    hit
      ? {
          companyName: hit.companyName,
          industry: hit.industry,
          employees: hit.employees,
          revenueBand: hit.revenueBand,
          hq: hit.hq,
        }
      : undefined,
  );
}

async function runOffline(): Promise<number> {
  const failures: Failure[] = [];
  console.log("winnow eval — offline (CI gate, no LLM)");

  if (EVAL_CASES.length !== REQUIRED_CASE_COUNT) {
    fail(
      failures,
      `expected ${REQUIRED_CASE_COUNT} cases, found ${EVAL_CASES.length}`,
    );
  }

  const ids = new Set<string>();
  const tagHits = new Set<string>();
  const results: CaseResult[] = [];

  for (const c of EVAL_CASES) {
    if (!c.id || !c.name) {
      fail(failures, "case missing id or name", c.id);
    }
    if (ids.has(c.id)) {
      fail(failures, `duplicate case id ${c.id}`, c.id);
    }
    ids.add(c.id);

    if (!c.input?.email) {
      fail(failures, "case missing input.email", c.id);
    }
    for (const t of c.tags ?? []) tagHits.add(t);

    if (!tierRouteConsistent(c.expectedTier, c.expectedShouldRoute)) {
      fail(
        failures,
        `tier/shouldRoute inconsistent: tier=${c.expectedTier} shouldRoute=${c.expectedShouldRoute}`,
        c.id,
      );
    }

    // Enrichment path over pure firmographics (no DB).
    const profile = enrichOffline(c.input.email);
    if (FREE_EMAIL_DOMAINS.has(extractDomain(c.input.email))) {
      if (!profile.personal) {
        fail(failures, "free-email domain must mark personal=true", c.id);
      }
    }

    // Self-consistency: compareCase against the golden itself must pass.
    const self = compareCase(
      {
        expectedTier: c.expectedTier,
        expectedSegment: c.expectedSegment,
        expectedShouldRoute: c.expectedShouldRoute,
      },
      {
        tier: c.expectedTier,
        segment: c.expectedSegment,
        shouldRoute: c.expectedShouldRoute,
      },
    );
    if (!self.pass) {
      fail(failures, `compareCase self-check failed: ${self.failures.join("; ")}`, c.id);
    }

    // Band policy still maps expected tiers to expected routing.
    const bandScore =
      c.expectedTier === "high" ? 0.9 : c.expectedTier === "medium" ? 0.5 : 0.1;
    const band = bandForScore(bandScore);
    const bandRoutes = band === "auto";
    if (bandRoutes !== c.expectedShouldRoute) {
      fail(
        failures,
        `band policy vs label: tier=${c.expectedTier} band=${band} expectedShouldRoute=${c.expectedShouldRoute}`,
        c.id,
      );
    }

    results.push({
      caseId: c.id,
      tier: c.expectedTier,
      segment: c.expectedSegment,
      shouldRoute: c.expectedShouldRoute,
      pass: true,
      failures: [],
      tags: c.tags,
    });
  }

  for (const tag of REQUIRED_TAG_GROUPS) {
    if (!tagHits.has(tag)) {
      fail(failures, `suite missing required tag group: ${tag}`);
    }
  }

  // Prompt hash + run id must be stable for identical inputs.
  const firmographicsRows = generateFirmographics().sort((a, b) =>
    a.domain.localeCompare(b.domain),
  );
  const promptMaterial = [
    `${SYSTEM_PROMPT}\n${PROMPT_RULES.join("\n")}`,
    buildPrompt(DEFAULT_ICP, SENTINEL_SCORE_INPUT),
    createHash("sha256")
      .update(JSON.stringify(firmographicsRows))
      .digest("hex"),
  ].join("\n");
  const hashA = promptHashFor(DEFAULT_ICP, promptMaterial, EVAL_CASES);
  const hashB = promptHashFor(DEFAULT_ICP, promptMaterial, EVAL_CASES);
  if (hashA !== hashB || hashA.length !== 12) {
    fail(failures, `promptHash unstable or wrong length: ${hashA} / ${hashB}`);
  }
  const runId = runIdFor("offline-ci", hashA);
  if (!runId.startsWith("eval_offline-ci_")) {
    fail(failures, `runId unexpected: ${runId}`);
  }

  const summary = summarize(results);
  if (summary.caseCount !== EVAL_CASES.length) {
    fail(
      failures,
      `summarize caseCount ${summary.caseCount} != ${EVAL_CASES.length}`,
    );
  }
  if (summary.passCount !== EVAL_CASES.length || summary.accuracy !== 1) {
    fail(
      failures,
      `self-labeled summarize expected perfect accuracy, got ${summary.passCount}/${summary.caseCount}`,
    );
  }

  // Exercise segment type surface so refactors break this gate.
  const segments = new Set(EVAL_CASES.map((c) => c.expectedSegment as Segment));
  if (segments.size < 3) {
    fail(failures, `expected at least 3 distinct segments, got ${[...segments]}`);
  }

  console.log(
    JSON.stringify(
      {
        mode: "offline",
        caseCount: EVAL_CASES.length,
        tagGroups: REQUIRED_TAG_GROUPS.filter((t) => tagHits.has(t)),
        promptHash: hashA,
        runId,
        accuracy: summary.accuracy,
        byTag: summary.byTag,
        failures: failures.length,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    console.error("\nFAIL — offline eval gate:");
    for (const f of failures) {
      console.error(`  - ${f.caseId ? `[${f.caseId}] ` : ""}${f.message}`);
    }
    return 1;
  }

  console.log(
    `\nPASS — ${EVAL_CASES.length} golden cases: shape, band policy, enrichment, prompt hash.`,
  );
  return 0;
}

async function runLive(): Promise<number> {
  console.log("winnow eval — live (LLM enrich→score path)");
  // Load env + seed before runEval so dialect/selection matches the app.
  await import("@agent-native/core/scripts");
  const { getDb, schema } = await import("../server/db/index.js");
  const { generateFirmographics } = await import(
    "../server/seed/firmographics.js"
  );
  const { DEFAULT_ICP: icp, ICP_SETTING_KEY } = await import(
    "../server/lib/leads.js"
  );
  const { eq, inArray } = await import("@agent-native/core/db/schema");

  const db = getDb();
  const rows = generateFirmographics();
  const existing = await db
    .select({ domain: schema.firmographics.domain })
    .from(schema.firmographics)
    .where(
      inArray(
        schema.firmographics.domain,
        rows.map((r) => r.domain),
      ),
    );
  const have = new Set(existing.map((r) => r.domain));
  const missing = rows.filter((r) => !have.has(r.domain));
  if (missing.length > 0) {
    await db.insert(schema.firmographics).values(missing);
  }
  await db
    .delete(schema.qualifySettings)
    .where(eq(schema.qualifySettings.key, ICP_SETTING_KEY));
  await db.insert(schema.qualifySettings).values({
    key: ICP_SETTING_KEY,
    value: icp,
    updatedAt: new Date().toISOString(),
  });
  await db.delete(schema.evalCases);
  await db.insert(schema.evalCases).values(
    EVAL_CASES.map((c) => ({
      id: c.id,
      name: c.name,
      input: JSON.stringify(c.input),
      expectedTier: c.expectedTier,
      expectedSegment: c.expectedSegment,
      expectedShouldRoute: c.expectedShouldRoute,
      tags: JSON.stringify(c.tags),
      createdAt: new Date().toISOString(),
    })),
  );
  console.log(
    `seeded firmographics (+${missing.length}), icp, ${EVAL_CASES.length} eval cases`,
  );

  const { runEval } = await import("../server/lib/eval-runner.js");
  const result = await runEval({ db });
  const failing = result.results.filter((r) => !r.pass);

  console.log(
    JSON.stringify(
      {
        mode: "live",
        runId: result.runId,
        model: result.model,
        promptHash: result.promptHash,
        accuracy: result.summary.accuracy,
        caseCount: result.summary.caseCount,
        passCount: result.summary.passCount,
        byTag: result.summary.byTag,
        totalCostUsd: result.totalCostUsd,
        failing: failing.map((r) => ({
          caseId: r.caseId,
          failures: r.failures,
        })),
      },
      null,
      2,
    ),
  );

  if (failing.length > 0) {
    console.error(
      `\nFAIL — live eval ${result.summary.passCount}/${result.summary.caseCount} (${(result.summary.accuracy * 100).toFixed(1)}%)`,
    );
    return 1;
  }

  console.log(
    `\nPASS — live eval ${result.summary.passCount}/${result.summary.caseCount}`,
  );
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live") || process.env.WINNOW_EVAL_MODE === "live";
  try {
    const code = live ? await runLive() : await runOffline();
    process.exit(code);
  } catch (err) {
    console.error("eval crashed:", err);
    process.exit(1);
  }
}

main();

// One-shot funnel backfill (U7): replays every lead's audit JSON into
// funnel events with the ORIGINAL timestamps, so the public dashboard has
// the full history instead of starting from the tracking cutover.
// Aborts if the funnel already has submissions unless --force is passed.
// Run: pnpm --filter qualify exec tsx scripts/backfill-funnel.ts [--force]

// Import order is load-bearing: evaluating @agent-native/core/scripts runs
// loadEnv(), which loads this app's .env (DATABASE_URL, ANALYTICS_*).
import "@agent-native/core/scripts";

const { getDb, schema } = await import("../server/db/index.js");

const TRACK_URL =
  process.env.ANALYTICS_TRACK_URL ?? "http://127.0.0.1:8080/analytics/track";
const PUBLIC_KEY = process.env.ANALYTICS_PUBLIC_KEY;
const FUNNEL_URL =
  process.env.ANALYTICS_FUNNEL_URL ??
  "http://127.0.0.1:8080/analytics/_agent-native/actions/get-public-funnel";

if (!PUBLIC_KEY) {
  console.error("ANALYTICS_PUBLIC_KEY is not set — nothing to do");
  process.exit(1);
}

if (!process.argv.includes("--force")) {
  const res = await fetch(FUNNEL_URL, { cache: "no-store" });
  const funnel = (await res.json()) as {
    submissionsByDay?: { n: number }[];
  };
  const existing = (funnel.submissionsByDay ?? []).reduce((a, r) => a + r.n, 0);
  if (existing > 0) {
    console.error(
      `funnel already has ${existing} submissions — pass --force to backfill anyway`,
    );
    process.exit(1);
  }
}

interface AuditEntry {
  at: string;
  actor: string;
  channel?: string;
  event: string;
  detail?: string;
}

const db = getDb();
const leads = await db.select().from(schema.leads);
console.log(`backfilling ${leads.length} leads`);

let sent = 0;
async function post(
  event: string,
  anonymousId: string,
  properties: Record<string, unknown>,
  timestamp: string,
) {
  const res = await fetch(TRACK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-native-analytics-key": PUBLIC_KEY!,
    },
    body: JSON.stringify({
      events: [
        {
          event,
          anonymousId,
          properties: { app: "qualify", ...properties },
          timestamp,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`track ${event} failed: ${res.status} ${await res.text()}`);
  }
  sent += 1;
}

for (const lead of leads) {
  const anon = lead.formResponseId ?? lead.id;
  const audit = JSON.parse(lead.audit) as AuditEntry[];
  const enrichment = lead.enrichment ? JSON.parse(lead.enrichment) : null;
  const proposal = lead.proposal ? JSON.parse(lead.proposal) : null;

  for (const entry of audit) {
    switch (entry.event) {
      case "lead-created":
        await post(
          "lead_submitted",
          anon,
          { source: lead.formResponseId ? "talk-to-sales" : "direct" },
          entry.at,
        );
        break;
      case "enriched":
        await post(
          "lead_enriched",
          anon,
          {
            matched: enrichment?.matched ?? false,
            industry: enrichment?.matched ? enrichment.industry : null,
          },
          entry.at,
        );
        break;
      case "scored":
        if (lead.fitScore !== null) {
          await post(
            "lead_scored",
            anon,
            {
              fitScore: lead.fitScore,
              tier: lead.tier,
              segment: lead.segment,
              model: lead.llmModel,
              costUsd: lead.llmCostUsd,
            },
            entry.at,
          );
        }
        break;
      case "routing-proposed":
        await post(
          "lead_routing_proposed",
          anon,
          { band: proposal?.band ?? "unknown" },
          entry.at,
        );
        if (proposal?.band === "disqualify") {
          await post(
            "lead_disqualified",
            anon,
            { reason: "low-fit" },
            entry.at,
          );
        }
        break;
      case "approved":
        await post(
          "lead_approved",
          anon,
          { channel: entry.channel ?? "app" },
          entry.at,
        );
        break;
      case "rejected":
        await post(
          "lead_rejected",
          anon,
          { channel: entry.channel ?? "app" },
          entry.at,
        );
        await post(
          "lead_disqualified",
          anon,
          { reason: "rejected", channel: entry.channel ?? "app" },
          entry.at,
        );
        break;
      default:
        // Structured route props only exist in scheduler's lead_routes; the
        // funnel consumes counts, so bare events suffice for history.
        if (entry.event === "status:approved→routed") {
          await post("lead_routed", anon, {}, entry.at);
        } else if (entry.event.endsWith("→booked")) {
          await post("lead_booked", anon, {}, entry.at);
        }
    }
  }
}

console.log(`backfill complete: ${sent} events`);
process.exit(0);

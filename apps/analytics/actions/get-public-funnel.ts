import { defineAction } from "@agent-native/core/action";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";

/**
 * Anonymous, sanitized read of the live inbound funnel for the public
 * `/funnel` page. Runs a fixed set of aggregate queries server-side — no
 * caller-supplied SQL — over the first-party event stream the qualify app
 * emits (app = 'qualify'). What leaves the server: aggregate
 * funnel/tier/segment/timing stats plus recent per-event score rows carrying
 * only {timestamp, tier, segment, fitScore} — no lead ids, emails, or other
 * identifiers. The generic panel-query pipeline stays auth-gated; this is the
 * capability-scoped public projection, same pattern as get-public-status-page.
 *
 * Registered in server/plugins/auth.ts publicPaths.
 */

const FUNNEL_SQL = `SELECT CASE event_name WHEN 'lead_submitted' THEN '1 submitted' WHEN 'lead_enriched' THEN '2 enriched' WHEN 'lead_scored' THEN '3 scored' WHEN 'lead_routed' THEN '4 routed' WHEN 'lead_booked' THEN '5 booked' ELSE event_name END AS stage, COUNT(*) AS n FROM analytics_events WHERE event_name IN ('lead_submitted','lead_enriched','lead_scored','lead_routed','lead_booked') AND app = 'qualify' GROUP BY event_name ORDER BY CASE event_name WHEN 'lead_submitted' THEN 1 WHEN 'lead_enriched' THEN 2 WHEN 'lead_scored' THEN 3 WHEN 'lead_routed' THEN 4 WHEN 'lead_booked' THEN 5 ELSE 9 END`;

const BY_DAY_SQL = `SELECT event_date AS date, COUNT(*) AS submissions FROM analytics_events WHERE event_name = 'lead_submitted' AND app = 'qualify' GROUP BY event_date ORDER BY date`;

const TIER_SQL = `SELECT COALESCE(properties::jsonb ->> 'tier', 'unknown') AS tier, COUNT(*) AS n FROM analytics_events WHERE event_name = 'lead_scored' AND app = 'qualify' GROUP BY tier ORDER BY n DESC`;

const SEGMENT_SQL = `SELECT COALESCE(properties::jsonb ->> 'segment', 'unknown') AS segment, COUNT(*) AS n FROM analytics_events WHERE event_name = 'lead_scored' AND app = 'qualify' GROUP BY segment ORDER BY n DESC`;

const TIME_TO_ROUTE_SQL = `WITH t0 AS (SELECT anonymous_id, MIN(timestamp::timestamptz) AS started FROM analytics_events WHERE event_name='lead_submitted' AND app = 'qualify' GROUP BY anonymous_id), t1 AS (SELECT anonymous_id, MIN(timestamp::timestamptz) AS routed FROM analytics_events WHERE event_name='lead_routed' AND app = 'qualify' GROUP BY anonymous_id) SELECT COUNT(*) AS routed_leads, COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t1.routed - t0.started))), 0)::int AS median_seconds FROM t0 JOIN t1 USING (anonymous_id)`;

const APPROVAL_LATENCY_SQL = `WITH p AS (SELECT anonymous_id, MIN(timestamp::timestamptz) AS parked FROM analytics_events WHERE event_name='lead_routing_proposed' AND properties::jsonb ->> 'band' = 'review' AND app = 'qualify' GROUP BY anonymous_id), d AS (SELECT anonymous_id, MIN(timestamp::timestamptz) AS decided FROM analytics_events WHERE event_name IN ('lead_approved','lead_rejected') AND app = 'qualify' GROUP BY anonymous_id) SELECT COUNT(*) AS decided, COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.decided - p.parked))), 0)::int AS median_seconds FROM p JOIN d USING (anonymous_id)`;

const PENDING_SQL = `SELECT COUNT(*) AS open FROM (SELECT anonymous_id FROM analytics_events WHERE event_name='lead_routing_proposed' AND properties::jsonb->>'band'='review' AND app = 'qualify' GROUP BY anonymous_id) p LEFT JOIN (SELECT anonymous_id FROM analytics_events WHERE event_name IN ('lead_approved','lead_rejected') AND app = 'qualify' GROUP BY anonymous_id) d USING (anonymous_id) WHERE d.anonymous_id IS NULL`;

const EVAL_SQL = `SELECT (properties::jsonb ->> 'accuracy')::float AS accuracy, properties::jsonb ->> 'model' AS model, properties::jsonb ->> 'caseCount' AS case_count, timestamp AS created_at FROM analytics_events WHERE event_name = 'eval_completed' AND app = 'qualify' ORDER BY timestamp DESC LIMIT 1`;

const RECENT_SQL = `SELECT timestamp AS time, properties::jsonb ->> 'tier' AS tier, properties::jsonb ->> 'segment' AS segment, properties::jsonb ->> 'fitScore' AS fit FROM analytics_events WHERE event_name = 'lead_scored' AND app = 'qualify' ORDER BY timestamp DESC LIMIT 12`;

export default defineAction({
  description:
    "Public read of the aggregate inbound funnel (stage counts, tiers, segments, latencies, eval accuracy). Fixed server-side queries, sanitized aggregates only — no caller SQL, no lead identifiers.",
  schema: z.object({}),
  http: { method: "GET" },
  requiresAuth: false,
  run: async () => {
    if (!isPostgres()) throw new Error("public funnel requires Postgres");
    const exec = getDbExec();
    const q = async (sql: string) => {
      const res = await exec.execute({ sql });
      return res.rows as Record<string, unknown>[];
    };

    const [
      funnel,
      submissionsByDay,
      tierDistribution,
      segmentDistribution,
      timeToRoute,
      approvalLatency,
      pending,
      evalRow,
      recentScores,
    ] = await Promise.all([
      q(FUNNEL_SQL),
      q(BY_DAY_SQL),
      q(TIER_SQL),
      q(SEGMENT_SQL),
      q(TIME_TO_ROUTE_SQL),
      q(APPROVAL_LATENCY_SQL),
      q(PENDING_SQL),
      q(EVAL_SQL),
      q(RECENT_SQL),
    ]);

    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const ttr = timeToRoute[0] ?? {};
    const lat = approvalLatency[0] ?? {};
    const evalLatest = evalRow[0];

    return {
      generatedAt: new Date().toISOString(),
      funnel: funnel.map((r) => ({ stage: String(r.stage), n: num(r.n) })),
      submissionsByDay: submissionsByDay.map((r) => ({
        date: String(r.date),
        n: num(r.submissions),
      })),
      tierDistribution: tierDistribution.map((r) => ({
        label: String(r.tier),
        n: num(r.n),
      })),
      segmentDistribution: segmentDistribution.map((r) => ({
        label: String(r.segment),
        n: num(r.n),
      })),
      routedLeads: num(ttr.routed_leads),
      medianSecondsToRoute: num(ttr.median_seconds),
      decidedApprovals: num(lat.decided),
      approvalLatencySeconds: num(lat.median_seconds),
      pendingApprovals: num(pending[0]?.open),
      eval: evalLatest
        ? {
            accuracy: Number(evalLatest.accuracy),
            model: String(evalLatest.model),
            caseCount: num(evalLatest.case_count),
            createdAt: String(evalLatest.created_at),
          }
        : null,
      recentScores: recentScores.map((r) => ({
        time: String(r.time),
        tier: String(r.tier),
        segment: String(r.segment),
        fit: r.fit == null ? null : Number(r.fit),
      })),
    };
  },
});

import { useEffect, useState } from "react";

/**
 * Public, no-login funnel page for the Inbound lead-router demo. Renders the
 * sanitized aggregates from the anonymous `get-public-funnel` action — the
 * same event stream the logged-in sql-dashboard reads. Anonymous surfaces in
 * this workspace are capability-scoped reads behind publicPaths, never the
 * generic SQL pipeline.
 */

interface FunnelPayload {
  generatedAt: string;
  funnel: { stage: string; n: number }[];
  submissionsByDay: { date: string; n: number }[];
  tierDistribution: { label: string; n: number }[];
  segmentDistribution: { label: string; n: number }[];
  routedLeads: number;
  medianSecondsToRoute: number;
  decidedApprovals: number;
  approvalLatencySeconds: number;
  pendingApprovals: number;
  eval: {
    accuracy: number;
    model: string;
    caseCount: number;
    createdAt: string;
  } | null;
  recentScores: {
    time: string;
    tier: string;
    segment: string;
    fit: number | null;
  }[];
}

export function meta() {
  return [{ title: "Inbound funnel — live demo" }];
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

function Bars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; n: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-300">{title}</h2>
      {rows.length === 0 && (
        <p className="text-xs text-zinc-600">No data yet.</p>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-28 truncate text-right text-xs text-zinc-500">
              {r.label}
            </span>
            <div className="h-4 flex-1 rounded bg-zinc-800">
              <div
                className="h-4 rounded bg-emerald-600/70"
                style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }}
              />
            </div>
            <span className="w-8 text-xs text-zinc-400">{r.n}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function PublicFunnelPage() {
  const [data, setData] = useState<FunnelPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/_agent-native/actions/get-public-funnel", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as FunnelPayload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "poll failed");
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const tierRows = (data?.tierDistribution ?? []).map((r) => ({
    label: r.label,
    n: r.n,
  }));
  const segmentRows = (data?.segmentDistribution ?? []).map((r) => ({
    label: r.label,
    n: r.n,
  }));
  const funnelRows = (data?.funnel ?? []).map((f) => ({
    label: f.stage.replace(/^\d /, ""),
    n: f.n,
  }));

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-zinc-950 px-6 py-12 text-zinc-100">
      <header className="mb-8">
        <p className="text-sm text-zinc-500">
          Inbound · live conversion funnel
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Lead router, end to end</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Form submit → agent enrichment → LLM ICP scoring (visible reasoning) →
          human review gate → round-robin routing → booked meeting. Synthetic
          demo data, refreshed live.
        </p>
      </header>

      {error && (
        <p className="mb-4 text-sm text-red-400">Refresh failed: {error}</p>
      )}
      {!data && !error && <p className="text-sm text-zinc-500">Loading…</p>}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric
              label="Qualifier accuracy"
              value={
                data.eval ? `${(data.eval.accuracy * 100).toFixed(0)}%` : "—"
              }
              hint={
                data.eval
                  ? `${data.eval.caseCount} golden cases · ${data.eval.model}`
                  : "eval pending"
              }
            />
            <Metric
              label="Leads routed"
              value={String(data.routedLeads)}
              hint={`median ${data.medianSecondsToRoute}s submit → route`}
            />
            <Metric
              label="Awaiting human review"
              value={String(data.pendingApprovals)}
              hint="mid-band HITL gate"
            />
            <Metric
              label="Approval latency"
              value={`${data.approvalLatencySeconds}s`}
              hint={`${data.decidedApprovals} human decisions`}
            />
          </div>

          <Bars title="Funnel — submissions to bookings" rows={funnelRows} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Bars title="Fit tier" rows={tierRows} />
            <Bars title="Segment" rows={segmentRows} />
          </div>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-300">
              Recent scored leads
            </h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-zinc-600">
                  <th className="pb-2 font-normal">Time (UTC)</th>
                  <th className="pb-2 font-normal">Tier</th>
                  <th className="pb-2 font-normal">Segment</th>
                  <th className="pb-2 font-normal">Fit</th>
                </tr>
              </thead>
              <tbody className="text-zinc-400">
                {data.recentScores.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-800/60">
                    <td className="py-1.5">
                      {r.time.replace("T", " ").slice(5, 19)}
                    </td>
                    <td className="py-1.5">{r.tier}</td>
                    <td className="py-1.5">{r.segment}</td>
                    <td className="py-1.5">
                      {r.fit == null ? "—" : r.fit.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <footer className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        {data && (
          <span>
            Updated {new Date(data.generatedAt).toLocaleTimeString()} ·{" "}
          </span>
        )}
        Aggregates only — no lead identifiers leave the server. Demo with
        synthetic data.{" "}
        <a
          href="/forms/f/talk-to-sales"
          className="text-zinc-400 underline underline-offset-2"
        >
          Submit a lead →
        </a>
      </footer>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";

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
  return [
    { title: "Inbound funnel — live demo" },
    { name: "referrer", content: "no-referrer" },
  ];
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
  highlightLabel,
}: {
  title: string;
  rows: { label: string; n: number }[];
  highlightLabel?: string | null;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-300">{title}</h2>
      {rows.length === 0 && (
        <p className="text-xs text-zinc-600">No data yet.</p>
      )}
      <div className="space-y-2">
        {rows.map((r) => {
          const highlighted =
            highlightLabel &&
            r.label.toLowerCase().includes(highlightLabel.toLowerCase());
          return (
            <div key={r.label} className="flex items-center gap-3 text-sm">
              <span
                className={`w-24 shrink-0 truncate ${highlighted ? "font-medium text-emerald-300" : "text-zinc-400"}`}
              >
                {r.label}
                {highlighted ? " ← you" : ""}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
                <div
                  className={`h-full rounded ${highlighted ? "bg-emerald-400" : "bg-zinc-500"}`}
                  style={{ width: `${(r.n / max) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-zinc-500">{r.n}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function PublicFunnelPage() {
  const [data, setData] = useState<FunnelPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [highlight, setHighlight] = useState<{
    stageLabel: string;
  } | null>(null);

  const journeyToken = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("j");
  }, []);

  useEffect(() => {
    // Derive the mount prefix ("" direct-dev, "/analytics" dev-gateway,
    // "/inbound/analytics" prod) so fetches work behind the gateway.
    const b = window.location.pathname.replace(/\/funnel\/?$/, "");
    setBase(b);
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `${b}/_agent-native/actions/get-public-funnel`,
          {
            cache: "no-store",
          },
        );
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

  useEffect(() => {
    if (!journeyToken || !base) return;
    // Cross-app: qualify owns the opaque token map. Derive sibling qualify base.
    const qualifyBase = base.endsWith("/analytics")
      ? `${base.slice(0, -"/analytics".length)}/qualify`
      : "/qualify";
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${qualifyBase}/_agent-native/actions/get-journey-funnel-highlight?token=${encodeURIComponent(journeyToken)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          found?: boolean;
          stageLabel?: string;
        };
        if (!cancelled && json.found && json.stageLabel) {
          setHighlight({ stageLabel: json.stageLabel });
        }
      } catch {
        // Soft fail — funnel still shows aggregates.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journeyToken, base]);

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

  const formsBase = base.endsWith("/analytics")
    ? `${base.slice(0, -"/analytics".length)}/forms`
    : "/forms";

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

          {highlight && (
            <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
              Your submission advanced to{" "}
              <span className="font-medium">{highlight.stageLabel}</span> —
              aggregates only, no lead identifiers.
            </p>
          )}
          <Bars
            title="Funnel — submissions to bookings"
            rows={funnelRows}
            highlightLabel={highlight?.stageLabel}
          />
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
          href={`${formsBase}/f/talk-to-sales`}
          className="text-zinc-400 underline underline-offset-2"
        >
          Submit a lead →
        </a>
      </footer>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

/**
 * Public lead-status page — the "watch the agent work" surface. Impersonal
 * SSR shell; all data loads client-side from the anonymous get-lead-status
 * action keyed by the form response id (unguessable capability key).
 */

interface AuditEntry {
  at: string;
  actor: "agent" | "human" | "system";
  event: string;
  detail?: string;
  channel?: string;
}

interface LeadStatus {
  status: string;
  name: string | null;
  fitScore: number | null;
  tier: string | null;
  segment: string | null;
  scoreReasoning: string | null;
  proposal: {
    band: string;
    eventTypeSlug: string;
    reason: string;
    evaluatedAt: string;
  } | null;
  enrichment: {
    matched: boolean;
    companyName: string | null;
    industry: string | null;
    employees: number | null;
    unverified: boolean;
  } | null;
  llmModel: string | null;
  llmCostUsd: number;
  audit: AuditEntry[];
  createdAt: string;
  updatedAt: string;
}

type Payload = { found: false } | { found: true; lead: LeadStatus };

type EvalPayload = {
  found: boolean;
  eval?: {
    accuracy: number;
    caseCount: number;
    model: string;
    createdAt: string;
  };
};

const STAGES = [
  { key: "received", label: "Received" },
  { key: "enriching", label: "Enriched" },
  { key: "scored", label: "Scored" },
  { key: "decision", label: "Decision" },
] as const;

const TERMINAL = new Set([
  "approved",
  "routed",
  "booked",
  "disqualified",
  "chain_failed",
]);

function stageIndex(status: string): number {
  if (status === "new") return 0;
  if (status === "enriching") return 1;
  if (status === "scored") return 2;
  return 3; // pending_approval, approved, routed, booked, disqualified, chain_failed
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const terminal = TERMINAL.has(status);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
        terminal
          ? status === "disqualified" || status === "chain_failed"
            ? "bg-zinc-800 text-zinc-300"
            : "bg-emerald-950 text-emerald-300"
          : "bg-amber-950 text-amber-300"
      }`}
    >
      {!terminal && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
        </span>
      )}
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function meta() {
  return [{ title: "Lead status — Inbound" }];
}

export default function LeadStatusPage() {
  const { responseId } = useParams();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evalInfo, setEvalInfo] = useState<EvalPayload | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/_agent-native/actions/get-eval-status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EvalPayload | null) => {
        if (data?.found) setEvalInfo(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!responseId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(
          `/_agent-native/actions/get-lead-status?responseId=${encodeURIComponent(responseId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Payload;
        if (!cancelled) setPayload(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "poll failed");
      }
    };

    void tick();
    timer.current = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [responseId]);

  const lead = payload?.found ? payload.lead : null;
  const currentStage = lead ? stageIndex(lead.status) : 0;

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-zinc-950 px-6 py-12 text-zinc-100">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-500">Inbound · live qualification</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {lead
              ? `Hi${lead.name ? ` ${lead.name.split(" ")[0]}` : ""}, your request is being worked`
              : "Qualifying your request"}
          </h1>
        </div>
        {lead && <StatusBadge status={lead.status} />}
      </header>

      {/* Pipeline */}
      <ol className="mb-8 flex items-center">
        {STAGES.map((stage, i) => {
          const done = lead
            ? i < currentStage ||
              (i === currentStage && TERMINAL.has(lead.status))
            : false;
          const active = lead
            ? i === currentStage && !TERMINAL.has(lead.status)
            : i === 0 && !lead;
          return (
            <li
              key={stage.key}
              className="flex flex-1 items-center last:flex-none"
            >
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${
                    done
                      ? "border-emerald-500 bg-emerald-500 text-zinc-950"
                      : active
                        ? "border-amber-400 text-amber-300"
                        : "border-zinc-700 text-zinc-500"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </div>
                <span
                  className={`mt-2 text-xs ${done || active ? "text-zinc-200" : "text-zinc-500"}`}
                >
                  {stage.label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div
                  className={`mx-2 mb-6 h-px flex-1 ${i < currentStage ? "bg-emerald-500" : "bg-zinc-800"}`}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Score card */}
      {lead?.fitScore !== null && lead?.fitScore !== undefined && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold">
              {lead.fitScore.toFixed(2)}
            </span>
            <span className="text-sm text-zinc-400">ICP fit</span>
            <span className="ml-auto rounded-md bg-zinc-800 px-2 py-1 text-xs">
              {lead.tier}
            </span>
            <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs">
              {lead.segment}
            </span>
          </div>
          {lead.scoreReasoning && (
            <blockquote className="mt-4 border-l-2 border-zinc-700 pl-4 text-sm text-zinc-300">
              {lead.scoreReasoning}
            </blockquote>
          )}
          {lead.proposal && (
            <p className="mt-4 text-sm text-zinc-400">{lead.proposal.reason}</p>
          )}
        </section>
      )}

      {/* Terminal banners */}
      {lead?.status === "disqualified" && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-300">
          Thanks for reaching out — it doesn&apos;t look like there&apos;s a
          strong fit right now. We&apos;ve kept your note on file if things
          change.
        </section>
      )}
      {lead && (lead.status === "approved" || lead.status === "routed") && (
        <section className="mb-8 rounded-xl border border-emerald-900 bg-emerald-950/40 p-6 text-sm text-emerald-200">
          You&apos;re qualified —{" "}
          {lead.status === "routed"
            ? "you've been routed to a specialist."
            : "routing you to a specialist now…"}
          {lead.proposal &&
            ` Next: ${lead.proposal.eventTypeSlug === "deep-dive" ? "technical deep dive (45 min)" : "discovery call (30 min)"}.`}
          {lead.status === "routed" && responseId && (
            <a
              href={`/scheduler/book/${encodeURIComponent(responseId)}`}
              className="mt-3 inline-block rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
            >
              Pick a time →
            </a>
          )}
        </section>
      )}
      {lead?.status === "pending_approval" && (
        <section className="mb-8 rounded-xl border border-amber-900 bg-amber-950/40 p-6 text-sm text-amber-200">
          Your request is with a human reviewer for a final check — this usually
          takes a few minutes.
        </section>
      )}
      {lead?.status === "booked" && (
        <section className="mb-8 rounded-xl border border-emerald-900 bg-emerald-950/40 p-6 text-sm text-emerald-200">
          You&apos;re booked — check your email for the calendar invite.
        </section>
      )}
      {lead?.status === "chain_failed" && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-300">
          Something went wrong on our side while working your request — the team
          has been notified and will pick it up from here.
        </section>
      )}

      {/* Live timeline */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          Agent activity
        </h2>
        {error && (
          <p className="text-xs text-red-400">polling error: {error}</p>
        )}
        {!lead && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Waiting for the agent to pick up your submission…
          </div>
        )}
        <ol className="space-y-3">
          {(lead?.audit ?? []).map((entry, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <span
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-semibold uppercase ${
                  entry.actor === "human"
                    ? "bg-sky-900 text-sky-200"
                    : entry.actor === "agent"
                      ? "bg-violet-900 text-violet-200"
                      : "bg-zinc-800 text-zinc-300"
                }`}
                title={entry.actor}
              >
                {entry.actor === "human"
                  ? "H"
                  : entry.actor === "agent"
                    ? "AI"
                    : "S"}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{entry.event}</span>
                  {entry.channel && (
                    <span className="text-xs text-zinc-500">
                      via {entry.channel}
                    </span>
                  )}
                  <span className="ml-auto flex-none text-xs text-zinc-500">
                    {timeLabel(entry.at)}
                  </span>
                </div>
                {entry.detail && (
                  <p className="mt-1 text-sm text-zinc-400">{entry.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        {lead?.llmModel && (
          <span>
            Scored by {lead.llmModel} · cost ${lead.llmCostUsd.toFixed(4)}{" "}
            ·{" "}
          </span>
        )}
        {evalInfo?.eval && (
          <span>
            Qualifier accuracy: {(evalInfo.eval.accuracy * 100).toFixed(0)}% ·{" "}
            {evalInfo.eval.caseCount} golden cases · {evalInfo.eval.model} ·{" "}
            {new Date(evalInfo.eval.createdAt).toLocaleDateString([], {
              month: "short",
              day: "numeric",
            })}{" "}
            ·{" "}
          </span>
        )}
        Demo with synthetic data — a public rebuild of production lead-to-cash
        systems.{" "}
        <a
          href="/analytics/funnel"
          className="text-zinc-400 underline underline-offset-2"
        >
          Live funnel →
        </a>
      </footer>
    </div>
  );
}

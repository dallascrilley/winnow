import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";

import {
  formatPublicEvalStatus,
  loadPublicEvalStatus,
} from "../lib/eval-status";
import type { PublicEvalStatus } from "../lib/eval-status";
import {
  apiBaseFromPathname,
  statusLookupState,
  workspacePrefixFromApiBase,
} from "../lib/status-path";

/**
 * Public lead-status page — the "watch the agent work" surface. Impersonal
 * SSR shell; all data loads client-side from the anonymous get-lead-status
 * action keyed by the form response id (unguessable capability key).
 */

interface AuditEntry {
  at: string;
  actor: "agent" | "human" | "system";
  event: string;
}

interface LeadStatus {
  status: string;
  name: string | null;
  fitScore: number | null;
  tier: string | null;
  segment: string | null;
  proposal: {
    eventTypeSlug: "discovery" | "deep-dive";
  } | null;
  audit: AuditEntry[];
  createdAt: string;
  journeyToken?: string | null;
}

type Payload = { found: false } | { found: true; lead: LeadStatus };

const STAGES = [
  { key: "received", label: "Received" },
  { key: "enrich", label: "Enrich" },
  { key: "score", label: "Score" },
  { key: "route", label: "Route" },
] as const;

const TERMINAL = new Set([
  "disqualified",
  "approved",
  "routed",
  "booked",
  "chain_failed",
  "pending_approval",
]);

function stageIndex(status: string): number {
  switch (status) {
    case "received":
    case "pending":
      return 0;
    case "enriching":
    case "enriched":
      return 1;
    case "scoring":
    case "scored":
    case "pending_approval":
    case "disqualified":
      return 2;
    case "approved":
    case "routing":
    case "routed":
    case "booked":
    case "chain_failed":
      return 3;
    default:
      return 0;
  }
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function elapsedLabel(fromIso: string, nowMs: number): string {
  const start = Date.parse(fromIso);
  if (Number.isNaN(start)) return "";
  const sec = Math.max(0, Math.floor((nowMs - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "disqualified" || status === "chain_failed"
      ? "border-zinc-600 text-zinc-300"
      : status === "pending_approval"
        ? "border-amber-500/60 text-amber-200"
        : status === "booked" || status === "routed" || status === "approved"
          ? "border-emerald-500/60 text-emerald-200"
          : "border-zinc-600 text-zinc-300";
  const label = status.split("_").join(" ");
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${tone}`}
    >
      {label}
    </span>
  );
}

export function meta() {
  return [
    { title: "Lead status — Inbound" },
    { name: "referrer", content: "no-referrer" },
  ];
}

export default function LeadStatusPage() {
  const { responseId } = useParams();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evalInfo, setEvalInfo] = useState<PublicEvalStatus | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [journeyToken, setJourneyToken] = useState<string | null>(null);
  const [statusLinkState, setStatusLinkState] =
    useState<ReturnType<typeof statusLookupState>>("pending");
  const missingStatusPolls = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const clock = useRef<number | undefined>(undefined);

  const bases = useMemo(() => {
    if (typeof window === "undefined") {
      return { api: "", workspace: "" };
    }
    const api = apiBaseFromPathname(window.location.pathname);
    return { api, workspace: workspacePrefixFromApiBase(api) };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPublicEvalStatus(fetch, bases.api).then((evalStatus) => {
      if (!cancelled) setEvalInfo(evalStatus);
    });

    return () => {
      cancelled = true;
    };
  }, [bases.api]);

  useEffect(() => {
    if (!responseId) return;
    let cancelled = false;
    let issuedJourney = false;
    missingStatusPolls.current = 0;
    setStatusLinkState("pending");

    const tick = async () => {
      try {
        const wantJourney = !issuedJourney;
        const res = await fetch(
          `${bases.api}/_agent-native/actions/get-lead-status`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              responseId,
              ...(wantJourney ? { issueJourney: "true" } : {}),
            }),
          },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Payload;
        if (!cancelled) {
          setPayload(data);
          setError(null);
          if (data.found) {
            missingStatusPolls.current = 0;
            setStatusLinkState("pending");
            if (data.lead.journeyToken) {
              issuedJourney = true;
              setJourneyToken((prev) => prev ?? data.lead.journeyToken ?? null);
            } else {
              // Lead exists; stop re-requesting journey mint after first found poll.
              issuedJourney = wantJourney;
            }
          } else {
            missingStatusPolls.current += 1;
            const nextStatusLinkState = statusLookupState(
              missingStatusPolls.current,
            );
            setStatusLinkState(nextStatusLinkState);
            if (nextStatusLinkState === "invalid") {
              window.clearInterval(timer.current);
            }
          }
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "poll failed");
      }
    };

    void tick();
    timer.current = window.setInterval(tick, 2500);
    clock.current = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer.current);
      window.clearInterval(clock.current);
    };
  }, [responseId, bases.api]);

  const lead = payload?.found ? payload.lead : null;
  const delayedStatusLink = statusLinkState === "delayed";
  const invalidStatusLink = statusLinkState === "invalid";
  const waitingForLead =
    payload !== null && !payload.found && !invalidStatusLink;
  const currentStage = lead ? stageIndex(lead.status) : 0;
  const bookHref = responseId
    ? `${bases.workspace}/scheduler/book/${encodeURIComponent(responseId)}`
    : "#";
  const funnelHref = journeyToken
    ? `${bases.workspace}/analytics/funnel?j=${encodeURIComponent(journeyToken)}`
    : `${bases.workspace}/analytics/funnel`;

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-zinc-950 px-6 py-12 text-zinc-100">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">Inbound · live qualification</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {lead
              ? `Hi${lead.name ? ` ${lead.name.split(" ")[0]}` : ""}, your request is being worked`
              : invalidStatusLink
                ? "This status link is invalid"
                : delayedStatusLink
                  ? "We're still setting up your status"
                  : "Qualifying your request"}
          </h1>
          {lead && !TERMINAL.has(lead.status) && (
            <p className="mt-2 text-xs text-zinc-500">
              Elapsed {elapsedLabel(lead.createdAt, nowMs)} · usually 30–90s
            </p>
          )}
          {waitingForLead && (
            <p className="mt-2 text-xs text-zinc-500">
              {delayedStatusLink
                ? "We couldn't start your status timeline yet. Keep this page open; we'll continue checking automatically."
                : "Submission received — waiting for the agent to open your case (usually under a minute)."}
            </p>
          )}
          {invalidStatusLink && (
            <p className="mt-2 text-xs text-zinc-500">
              We couldn't verify this status link. Submit a new request to
              create a fresh link.
            </p>
          )}
        </div>
        {lead && <StatusBadge status={lead.status} />}
      </header>

      <ol className="mb-8 flex items-center">
        {STAGES.map((stage, i) => {
          const done = lead
            ? i < currentStage ||
              (i === currentStage &&
                TERMINAL.has(lead.status) &&
                lead.status !== "pending_approval")
            : false;
          const active = lead
            ? i === currentStage && !TERMINAL.has(lead.status)
            : i === 0 && !lead && !invalidStatusLink;
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

      {lead?.fitScore !== null && lead?.fitScore !== undefined && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold">
              {lead.fitScore.toFixed(2)}
            </span>
            <span className="text-sm text-zinc-400">ICP fit</span>
            {lead.tier && (
              <span className="ml-auto rounded-md bg-zinc-800 px-2 py-1 text-xs">
                {lead.tier}
              </span>
            )}
            {lead.segment && (
              <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs">
                {lead.segment}
              </span>
            )}
          </div>
        </section>
      )}

      {lead?.status === "disqualified" && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-300">
          Thanks for reaching out — it doesn&apos;t look like there&apos;s a
          strong fit right now. We&apos;ve kept your note on file if things
          change.{" "}
          <a
            href={funnelHref}
            className="text-zinc-200 underline underline-offset-2"
          >
            See how scoring works on the funnel →
          </a>
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
              href={bookHref}
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
          takes a few minutes.{" "}
          <a
            href={funnelHref}
            className="text-amber-100 underline underline-offset-2"
          >
            Watch the funnel while you wait →
          </a>
        </section>
      )}
      {lead?.status === "booked" && (
        <section className="mb-8 rounded-xl border border-emerald-900 bg-emerald-950/40 p-6 text-sm text-emerald-200">
          You&apos;re booked — check your email for the calendar invite.{" "}
          <a
            href={funnelHref}
            className="text-emerald-100 underline underline-offset-2"
          >
            See your booking on the funnel →
          </a>
        </section>
      )}
      {lead?.status === "chain_failed" && (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-300">
          Something went wrong on our side while working your request — the team
          has been notified and will pick it up from here.
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          Agent activity
        </h2>
        {error && (
          <p className="mb-3 text-xs text-red-400">polling error: {error}</p>
        )}
        {!lead && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            {payload === null
              ? "Loading status…"
              : delayedStatusLink
                ? "We couldn't start your status timeline yet. This page will keep checking automatically."
                : "Waiting for the agent to pick up your submission…"}
          </div>
        )}
        <ol className="space-y-3">
          {(lead?.audit ?? []).map((entry, i) => (
            <li
              key={`${entry.at}-${entry.event}-${i}`}
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
                  <span className="ml-auto flex-none text-xs text-zinc-500">
                    {timeLabel(entry.at)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        Demo with synthetic data — a public rebuild of production lead-to-cash
        systems.{" "}
        <a
          href={funnelHref}
          className="text-zinc-400 underline underline-offset-2"
        >
          Live funnel →{" "}
        </a>
        {evalInfo && <span>{formatPublicEvalStatus(evalInfo)}</span>}
      </footer>
    </div>
  );
}

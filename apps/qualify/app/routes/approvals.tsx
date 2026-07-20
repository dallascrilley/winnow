import { useCallback, useEffect, useState } from "react";

/**
 * Owner approval queue — pending_approval leads with one-click
 * approve/reject through decide-lead-approval. Session-gated (not in
 * publicPaths); every decision lands on the lead's public audit timeline.
 */

interface PendingLead {
  id: string;
  email: string;
  name: string | null;
  status: string;
  fitScore: number | null;
  tier: string | null;
  segment: string | null;
  llmCostUsd: number;
  createdAt: string;
  formResponseId?: string | null;
}

interface LeadDetail {
  scoreReasoning: string | null;
  proposal: { reason: string } | null;
  enrichment: {
    companyName: string | null;
    industry: string | null;
    employees: number | null;
  } | null;
  formResponseId?: string | null;
}

function apiBaseFromPathname(pathname: string): string {
  return pathname.replace(/\/approvals\/?$/, "");
}

function workspacePrefixFromApiBase(base: string): string {
  return base.replace(/\/qualify\/?$/, "") || "";
}

export function meta() {
  return [{ title: "Approvals — Inbound" }];
}

export default function ApprovalsPage() {
  const [leads, setLeads] = useState<PendingLead[]>([]);
  const [details, setDetails] = useState<Record<string, LeadDetail>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bases =
    typeof window === "undefined"
      ? { api: "", workspace: "" }
      : (() => {
          const api = apiBaseFromPathname(window.location.pathname);
          return { api, workspace: workspacePrefixFromApiBase(api) };
        })();

  const refresh = useCallback(async () => {
    const res = await fetch(
      `${bases.api}/_agent-native/actions/list-leads?status=pending_approval`,
      { cache: "no-store" },
    );
    const data = await res.json();
    const next = (data.leads ?? []) as PendingLead[];
    setLeads(next);
    setSelectedId((prev) => {
      if (prev && next.some((l) => l.id === prev)) return prev;
      return next[0]?.id ?? null;
    });
  }, [bases.api]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    for (const lead of leads) {
      if (details[lead.id]) continue;
      void (async () => {
        const res = await fetch(
          `${bases.api}/_agent-native/actions/get-lead?leadId=${encodeURIComponent(lead.id)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (data.lead) {
          setDetails((prev) => ({
            ...prev,
            [lead.id]: {
              scoreReasoning: data.lead.scoreReasoning,
              proposal: data.lead.proposal,
              enrichment: data.lead.enrichment,
              formResponseId: data.lead.formResponseId ?? null,
            },
          }));
        }
      })();
    }
  }, [leads, details, bases.api]);

  const decide = useCallback(
    async (leadId: string, decision: "approve" | "reject") => {
      setBusy(leadId + decision);
      setError(null);
      try {
        const res = await fetch(
          `${bases.api}/_agent-native/actions/decide-lead-approval`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ leadId, decision, channel: "app" }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `status ${res.status}`);
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        setDetails((prev) => {
          const next = { ...prev };
          delete next[leadId];
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "decision failed");
      } finally {
        setBusy(null);
      }
    },
    [bases.api],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!selectedId || busy) return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void decide(selectedId, "approve");
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void decide(selectedId, "reject");
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = leads.findIndex((l) => l.id === selectedId);
        const next = leads[Math.min(leads.length - 1, idx + 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = leads.findIndex((l) => l.id === selectedId);
        const next = leads[Math.max(0, idx - 1)];
        if (next) setSelectedId(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, busy, decide, leads]);

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-zinc-950 px-6 py-12 text-zinc-100">
      <p className="text-sm text-zinc-500">Inbound · review queue</p>
      <h1 className="mt-1 text-2xl font-semibold">
        Pending approvals{" "}
        <span className="ml-2 rounded-full bg-amber-950 px-3 py-1 text-sm text-amber-300">
          {leads.length}
        </span>
      </h1>
      <p className="mt-2 text-xs text-zinc-600">
        Shortcuts: A approve · R reject · J/K move (when not typing)
      </p>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-8 space-y-4">
        {leads.length === 0 && (
          <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Queue is clear. Mid-band leads (score 0.40–0.79) land here for a
            human decision.
          </p>
        )}
        {leads.map((lead) => {
          const detail = details[lead.id];
          const frid = detail?.formResponseId ?? lead.formResponseId;
          const statusHref = frid
            ? `${bases.workspace}/qualify/status/${encodeURIComponent(frid)}`
            : null;
          const selected = lead.id === selectedId;
          return (
            <article
              key={lead.id}
              onClick={() => setSelectedId(lead.id)}
              className={`rounded-xl border bg-zinc-900 p-6 ${
                selected
                  ? "border-amber-500/70 ring-1 ring-amber-500/40"
                  : "border-zinc-800"
              }`}
            >
              <header className="flex items-baseline gap-3">
                <h2 className="text-lg font-medium">
                  {lead.name ?? lead.email}
                  {detail?.enrichment?.companyName && (
                    <span className="ml-2 text-sm font-normal text-zinc-400">
                      {detail.enrichment.companyName}
                      {detail.enrichment.employees
                        ? ` · ${detail.enrichment.employees} employees`
                        : ""}
                      {detail.enrichment.industry
                        ? ` · ${detail.enrichment.industry}`
                        : ""}
                    </span>
                  )}
                </h2>
                <span className="ml-auto text-2xl font-bold">
                  {lead.fitScore?.toFixed(2) ?? "—"}
                </span>
              </header>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-400">
                <span className="rounded bg-zinc-800 px-2 py-0.5">
                  {lead.tier}
                </span>
                <span className="rounded bg-zinc-800 px-2 py-0.5">
                  {lead.segment}
                </span>
                <span className="rounded bg-zinc-800 px-2 py-0.5">
                  {lead.email}
                </span>
                <span className="rounded bg-zinc-800 px-2 py-0.5">
                  cost ${lead.llmCostUsd.toFixed(4)}
                </span>
              </div>
              {detail?.scoreReasoning && (
                <blockquote className="mt-4 border-l-2 border-zinc-700 pl-4 text-sm text-zinc-300">
                  {detail.scoreReasoning}
                </blockquote>
              )}
              {detail?.proposal && (
                <p className="mt-2 text-xs text-zinc-500">
                  {detail.proposal.reason}
                </p>
              )}
              <footer className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => decide(lead.id, "approve")}
                  disabled={busy !== null}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
                >
                  {busy === lead.id + "approve"
                    ? "Routing…"
                    : "Approve & route"}
                </button>
                <button
                  onClick={() => decide(lead.id, "reject")}
                  disabled={busy !== null}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                >
                  {busy === lead.id + "reject" ? "Rejecting…" : "Reject"}
                </button>
                {statusHref && (
                  <a
                    href={statusHref}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
                  >
                    Open visitor status ↗
                  </a>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

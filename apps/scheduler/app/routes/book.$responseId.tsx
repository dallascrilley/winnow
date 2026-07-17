import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";

/**
 * Public booking page for a routed lead — impersonal shell, anonymous
 * actions keyed by the form response id. Slots are host-pinned (the
 * round-robin decision is already made upstream).
 */

interface RouteInfo {
  status: string;
  eventTitle: string;
  eventLength: number;
  hostName: string;
  bookingUid: string | null;
}

interface Slot {
  start: string;
  end: string;
}

const TZ = "America/Chicago";

// Root-absolute action URLs 404 behind the workspace gateway — derive the app
// prefix from the current path ("" direct-dev, "/scheduler" dev-gateway,
// "/inbound/scheduler" prod). Client-only callers (useEffect / confirm).
function apiBase(): string {
  return window.location.pathname.replace(/\/book\/[^/]+\/?$/, "");
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function meta() {
  return [{ title: "Pick a time — Inbound" }];
}

export default function BookPage() {
  const { responseId } = useParams();
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoaded, setSlotsLoaded] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  useEffect(() => {
    if (!responseId) return;
    const base = apiBase();
    void (async () => {
      let data: { found?: boolean; route?: RouteInfo } | undefined;
      try {
        const res = await fetch(
          `${base}/_agent-native/actions/get-route?responseId=${encodeURIComponent(responseId)}`,
          { cache: "no-store" },
        );
        data = await res.json();
        const info = data?.route;
        // no_route / cancelled links have no bookable surface — don't strand the
        // page on "Loading availability…".
        if (
          !res.ok ||
          !data?.found ||
          !info ||
          (info.status !== "routed" && info.status !== "booked")
        ) {
          setNotFound(true);
          return;
        }
        setRoute(info);
        if (info.status !== "routed") return;
      } catch {
        setError(
          "Couldn't load this booking link — check your connection and refresh.",
        );
        return;
      }
      try {
        const slotsRes = await fetch(
          `${base}/_agent-native/actions/route-slots?responseId=${encodeURIComponent(responseId)}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&timezone=${encodeURIComponent(TZ)}`,
          { cache: "no-store" },
        );
        const slotsData = await slotsRes.json();
        setSlots(slotsData.slots ?? []);
      } catch {
        // Failed slots fetch falls through to empty slots — the loaded flag
        // renders the no-availability fallback instead of a stuck spinner.
      } finally {
        setSlotsLoaded(true);
      }
    })();
  }, [responseId, range]);

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of slots) {
      const day = dayLabel(slot.start);
      map.set(day, [...(map.get(day) ?? []), slot]);
    }
    return [...map.entries()];
  }, [slots]);

  const confirm = async () => {
    if (!selected || !responseId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase()}/_agent-native/actions/book-lead`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          responseId,
          startTime: selected.start,
          endTime: selected.end,
          timezone: TZ,
          attendeeName: name,
          attendeeEmail: email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `status ${res.status}`);
      setBooked(data.bookingUid ?? "confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-zinc-950 px-6 py-12 text-zinc-100">
      <p className="text-sm text-zinc-500">Inbound · booking</p>

      {notFound && (
        <h1 className="mt-2 text-xl font-semibold">
          This booking link isn&apos;t active.
        </h1>
      )}

      {error && !route && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {route && !booked && (
        <>
          <h1 className="mt-2 text-2xl font-semibold">
            {route.eventTitle} with {route.hostName}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {route.eventLength} minutes · times shown in {TZ.replace("_", " ")}
          </p>

          {route.status === "booked" ? (
            <section className="mt-8 rounded-xl border border-emerald-900 bg-emerald-950/40 p-6 text-sm text-emerald-200">
              You&apos;re already booked — check your email for the calendar
              invite.
            </section>
          ) : (
            <>
              <section className="mt-8 space-y-6">
                {byDay.length === 0 && (
                  <p className="text-sm text-zinc-500">
                    {slotsLoaded
                      ? "No availability in the next 7 days — we'll follow up by email."
                      : "Loading availability…"}
                  </p>
                )}
                {byDay.map(([day, daySlots]) => (
                  <div key={day}>
                    <h2 className="mb-2 text-sm font-medium text-zinc-400">
                      {day}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {daySlots.map((slot) => {
                        const isSelected = selected?.start === slot.start;
                        return (
                          <button
                            key={slot.start}
                            onClick={() => setSelected(slot)}
                            className={`rounded-lg border px-3 py-2 text-sm ${
                              isSelected
                                ? "border-emerald-500 bg-emerald-500 text-zinc-950"
                                : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-600"
                            }`}
                          >
                            {timeLabel(slot.start)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>

              {selected && (
                <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                  <h2 className="text-sm font-medium">
                    {timeLabel(selected.start)} on {dayLabel(selected.start)}
                  </h2>
                  <div className="mt-4 space-y-3">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                    />
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Work email"
                      type="email"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={confirm}
                      disabled={
                        submitting || !name.trim() || !email.includes("@")
                      }
                      className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {submitting ? "Booking…" : "Confirm booking"}
                    </button>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {booked && route && (
        <section className="mt-8 rounded-xl border border-emerald-900 bg-emerald-950/40 p-6">
          <h1 className="text-xl font-semibold text-emerald-200">
            You&apos;re booked with {route.hostName}
          </h1>
          <p className="mt-2 text-sm text-emerald-300">
            {dayLabel(selected!.start)} · {timeLabel(selected!.start)} (
            {TZ.replace("_", " ")})
          </p>
          <p className="mt-4 text-sm text-zinc-400">
            A calendar invite is on its way to {email}.
          </p>
        </section>
      )}

      <footer className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        Demo with synthetic data and a fictional sales team.
      </footer>
    </div>
  );
}

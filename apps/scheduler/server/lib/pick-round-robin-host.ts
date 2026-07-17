/**
 * App-side round-robin rotation. The scheduling package's assign-round-robin-host
 * measures bookings in the past 30 days, which never counts this app's
 * future-dated bookings, so every host sits at 0 and the priority-1 host wins
 * forever. This picker rotates over the app's own assignment history instead:
 * lead_routes rows per host for the event type — fewest assignments wins,
 * ties break by lowest host priority, then email for determinism.
 */

export interface RoundRobinHost {
  userEmail: string;
  /** Fixed hosts always attend; only non-fixed hosts rotate. */
  isFixed: boolean;
  /** Lower number = higher priority; hosts without one sort last. */
  priority: number | null;
}

export function pickRoundRobinHost(
  hosts: RoundRobinHost[],
  assignmentCounts: Readonly<Record<string, number>>,
): string | null {
  const candidates = hosts.filter((h) => !h.isFixed);
  if (candidates.length === 0) return null;
  const sorted = candidates.slice().sort((a, b) => {
    const ac = assignmentCounts[a.userEmail] ?? 0;
    const bc = assignmentCounts[b.userEmail] ?? 0;
    if (ac !== bc) return ac - bc;
    const ap = a.priority ?? Number.MAX_SAFE_INTEGER;
    const bp = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return a.userEmail.localeCompare(b.userEmail);
  });
  return sorted[0].userEmail;
}

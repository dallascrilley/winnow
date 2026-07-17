/**
 * Fire-and-forget funnel event emission to the analytics app's first-party
 * track endpoint (U7). Tracking must never break the qualification chain:
 * no key configured → no-op; request failure → swallowed. Properties are
 * minimized by convention — no emails, names, or company names; the
 * anonymousId is the unguessable form-response nanoid, which lets the
 * funnel stitch stages per lead without any PII leaving this app.
 */

const TRACK_URL =
  process.env.ANALYTICS_TRACK_URL ?? "http://127.0.0.1:8080/analytics/track";
const PUBLIC_KEY = process.env.ANALYTICS_PUBLIC_KEY;

export function trackFunnelEvent(
  event: string,
  anonymousId: string,
  properties: Record<string, unknown> = {},
  timestamp?: string,
): void {
  if (!PUBLIC_KEY) return;
  void fetch(TRACK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-native-analytics-key": PUBLIC_KEY,
    },
    body: JSON.stringify({
      events: [
        {
          event,
          anonymousId,
          properties: { app: "qualify", ...properties },
          timestamp: timestamp ?? new Date().toISOString(),
        },
      ],
    }),
  }).catch(() => {});
}

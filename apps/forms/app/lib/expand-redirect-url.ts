/**
 * Expand publisher redirect templates after a successful public submit.
 * Mirrors SSR behavior in server/lib/public-form-ssr.ts.
 */
export function expandRedirectUrl(
  url: string,
  vars: { responseId?: string; journeyToken?: string },
): string {
  let out = url;
  if (vars.responseId) {
    out = out.split("{responseId}").join(encodeURIComponent(vars.responseId));
  }
  if (vars.journeyToken) {
    out = out
      .split("{journeyToken}")
      .join(encodeURIComponent(vars.journeyToken));
  }
  return out;
}

/** Allow only http(s) absolute URLs or same-origin path redirects. */
export function safeRedirectUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;

  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return trimmed;
  } catch {
    return null;
  }

  return null;
}

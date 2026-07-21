/** Strip page suffix → app mount ("" direct, "/qualify" gateway, "/inbound/qualify" prod). */
export function apiBaseFromPathname(pathname: string): string {
  return pathname.replace(/\/status\/[^/]+\/?$/, "");
}

/** Workspace root prefix before /qualify (or empty when direct-mounted). */
export function workspacePrefixFromApiBase(base: string): string {
  return base.replace(/\/qualify\/?$/, "") || "";
}

/** At 2.5 seconds per poll, wait one minute for asynchronous lead creation. */
export const MAX_PENDING_STATUS_POLLS = 24;

/** Allow a further two minutes before treating a never-found link as invalid. */
export const MAX_DELAYED_STATUS_POLLS = MAX_PENDING_STATUS_POLLS * 3;

/**
 * A delayed handoff is distinct from an invalid link: a visitor with a fresh
 * response id should receive a clear recovery message before we give up.
 */
export function statusLookupState(
  polls: number,
): "pending" | "delayed" | "invalid" {
  if (polls >= MAX_DELAYED_STATUS_POLLS) return "invalid";
  if (polls >= MAX_PENDING_STATUS_POLLS) return "delayed";
  return "pending";
}

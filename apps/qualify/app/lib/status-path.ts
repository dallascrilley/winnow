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

/** Turns repeated missing status reads into a terminal invalid-link state. */
export function statusLookupState(polls: number): "pending" | "invalid" {
  if (polls >= MAX_PENDING_STATUS_POLLS) return "invalid";
  return "pending";
}

/** Strip page suffix → app mount ("" direct, "/qualify" gateway, "/inbound/qualify" prod). */
export function apiBaseFromPathname(pathname: string): string {
  return pathname.replace(/\/status\/[^/]+\/?$/, "");
}

/** Workspace root prefix before /qualify (or empty when direct-mounted). */
export function workspacePrefixFromApiBase(base: string): string {
  return base.replace(/\/qualify\/?$/, "") || "";
}

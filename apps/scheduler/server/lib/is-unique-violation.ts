/**
 * Portable unique-violation detector: postgres.js raises SQLSTATE 23505,
 * libsql raises "UNIQUE constraint failed: …". Pass a marker (index,
 * constraint, or table name) to scope the match to one specific constraint
 * when a statement could trip several.
 */

export function isUniqueViolation(err: unknown, marker?: string): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  const haystack = `${String(e.code ?? "")} ${String(e.message ?? "")}`;
  if (!/23505|unique constraint failed/i.test(haystack)) return false;
  return marker ? haystack.includes(marker) : true;
}

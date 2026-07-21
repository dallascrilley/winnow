export interface PublicEvalStatus {
  accuracy: number;
  caseCount: number;
  model: string;
  createdAt: string;
}

type PublicFetch = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Reads the aggregate-only public eval result without exposing eval case data. */
export async function loadPublicEvalStatus(
  fetcher: PublicFetch,
  apiBase: string,
): Promise<PublicEvalStatus | null> {
  try {
    const response = await fetcher(
      `${apiBase}/_agent-native/actions/get-eval-status`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) return null;
    const payload = data as Record<string, unknown>;
    if (payload.found !== true || typeof payload.eval !== "object") return null;

    const evalData = payload.eval as Record<string, unknown>;
    if (
      typeof evalData.accuracy !== "number" ||
      typeof evalData.caseCount !== "number" ||
      typeof evalData.model !== "string" ||
      typeof evalData.createdAt !== "string"
    ) {
      return null;
    }

    return {
      accuracy: evalData.accuracy,
      caseCount: evalData.caseCount,
      model: evalData.model,
      createdAt: evalData.createdAt,
    };
  } catch {
    return null;
  }
}

/** Formats the aggregate accuracy contract shown on the public status page. */
export function formatPublicEvalStatus(evalStatus: PublicEvalStatus): string {
  const date = new Date(evalStatus.createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? "date unavailable"
    : date.toLocaleDateString([], { month: "short", day: "numeric" });

  return `Qualifier accuracy: ${(evalStatus.accuracy * 100).toFixed(0)}% · ${evalStatus.caseCount} golden cases · ${evalStatus.model} · ${dateLabel}`;
}

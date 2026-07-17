import { signA2AToken, verifyA2AToken } from "@agent-native/core/a2a";
import { getHeader, type H3Event } from "h3";

/**
 * Workspace cross-app substrate.
 *
 * The framework's A2A *agent* client is SSRF-guarded and refuses loopback /
 * private / CGNAT addresses, so workspace siblings cannot use invokeAgent in
 * local dev. The dev-workspace pattern (and the one this workspace ships):
 * signed A2A JWTs over the shared A2A_SECRET + plain fetches to the sibling's
 * action HTTP surface, verified server-side via actionRouteAuth.
 */

/**
 * agent-chat `actionRouteAuth.resolveCaller` implementation. Returning null
 * defers to the session-cookie chain. `verifyA2AToken` never returns null —
 * it resolves verification failures to `{ email: null }` — so a claim set
 * without any identity must be treated as unauthenticated, not as a caller.
 */
export async function resolveA2ACaller(event: H3Event) {
  const authorization = getHeader(event, "authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length);
  const claims = (await verifyA2AToken(token, event)) as {
    email?: string | null;
    sub?: string | null;
  } | null;
  if (!claims?.email && !claims?.sub) return null;

  return {
    owner: claims.email ?? claims.sub ?? "a2a-sibling@inbound-demo.test",
    anonymous: false,
    name: "A2A sibling app",
  };
}

function workspaceBase(): string {
  return (
    process.env.WORKSPACE_GATEWAY_URL ??
    process.env.APP_URL ??
    "http://127.0.0.1:8080"
  ).replace(/\/$/, "");
}

/**
 * Call a sibling app's action over the workspace gateway with a signed A2A
 * JWT. Throws with the status + truncated body on non-OK responses.
 */
export async function siblingActionFetch<T = unknown>(
  appId: string,
  actionName: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    callerEmail?: string;
  } = {},
): Promise<T> {
  const token = await signA2AToken(
    options.callerEmail ??
      `${appId === "qualify" ? "scheduler" : "qualify"}@inbound-demo.test`,
    process.env.WORKSPACE_ORG_DOMAIN ?? "inbound-demo.test",
    undefined,
    { preferGlobalSecret: true },
  );

  const method = options.method ?? (options.body ? "POST" : "GET");
  const url = new URL(
    `${workspaceBase()}/${appId}/_agent-native/actions/${actionName}`,
  );
  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${token}` },
  };
  if (method === "GET" && options.body) {
    for (const [key, value] of Object.entries(options.body)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  } else if (options.body) {
    init.headers = {
      ...init.headers,
      "content-type": "application/json",
    };
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${appId}/${actionName} ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

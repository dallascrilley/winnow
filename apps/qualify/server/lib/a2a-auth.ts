import { verifyA2AToken } from "@agent-native/core/a2a";
import { getHeader, type H3Event } from "h3";

/**
 * actionRouteAuth resolver: lets sibling workspace apps call this app's
 * action surface with an A2A JWT (signed with the shared A2A_SECRET). This
 * is the dev-workspace cross-app path — the A2A *agent* client's SSRF guard
 * refuses loopback URLs, but signed action calls to the gateway are plain
 * server-to-server fetches.
 *
 * Contract (from core action-routes.js): returning null defers to the
 * session-cookie chain; throwing is a hard 401 (the credential was ours but
 * invalid).
 */
export async function resolveA2ACaller(event: H3Event) {
  const authorization = getHeader(event, "authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length);
  const claims = (await verifyA2AToken(token, event)) as {
    email?: string;
    sub?: string;
  } | null;
  if (!claims) return null;

  return {
    owner: claims.email ?? claims.sub ?? "a2a-sibling@inbound-demo.test",
    anonymous: false,
    name: "A2A sibling app",
  };
}

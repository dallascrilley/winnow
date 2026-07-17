import { setSchedulingContext } from "@agent-native/scheduling/server";

import { getDb, schema } from "./db/index.js";

/**
 * Nitro boots this via server/plugins/scheduling.ts with the request-scoped
 * email resolver; the `pnpm action` CLI boots it via actions/run.ts with the
 * env-scoped resolver. Everything else is shared.
 */
export function initSchedulingContext(
  getCurrentUserEmail: () => string | undefined,
): void {
  setSchedulingContext({
    getDb,
    schema,
    getCurrentUserEmail,
    publicBaseUrl: process.env.APP_URL,
  });
}

// Import order is load-bearing: evaluating @agent-native/core/scripts runs
// loadEnv(), which loads this app's .env — including DATABASE_URL, which the
// schema helpers in ./server/db read at module load to pick a SQL dialect.
// Keep this import first or CLI action runs silently fall back to SQLite.
import { runScript } from "@agent-native/core/scripts";

import { initSchedulingContext } from "../server/scheduling-context.js";

initSchedulingContext(
  // Same precedence as the script runner's dev-session: explicit
  // AGENT_USER_EMAIL wins; the fallback matches the workspace dev account
  // the runner auto-binds. If the runner ever warns about multiple session
  // owners, setting AGENT_USER_EMAIL fixes both resolvers at once.
  () => process.env.AGENT_USER_EMAIL ?? "dev@local.test",
);

runScript();

import { runScript } from "@agent-native/core/scripts";

import { initSchedulingContext } from "../server/scheduling-context.js";

initSchedulingContext(
  () => process.env.AGENT_USER_EMAIL ?? "dev@local.test",
);

runScript();

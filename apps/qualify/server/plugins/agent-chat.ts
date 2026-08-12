import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";
import * as workspaceServer from "@winnow/shared/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { resolveA2ACaller } from "../lib/a2a-auth.js";

const createWorkspaceAgentChatPlugin = (
  workspaceServer as Record<string, unknown>
).createWorkspaceAgentChatPlugin;
const options = {
  appId: "qualify",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  // Sibling apps call this app's actions with A2A JWTs (see
  // server/lib/a2a-auth.ts) — the dev-workspace cross-app path.
  actionRouteAuth: { resolveCaller: resolveA2ACaller },
} satisfies AgentChatPluginOptions;

export default typeof createWorkspaceAgentChatPlugin === "function"
  ? (
      createWorkspaceAgentChatPlugin as (
        options: AgentChatPluginOptions,
      ) => unknown
    )(options)
  : createAgentChatPlugin(options);

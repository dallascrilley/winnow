import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";
import * as workspaceServer from "@inbound/shared/server";
import { resolveA2ACaller } from "@inbound/shared/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const createWorkspaceAgentChatPlugin = (
  workspaceServer as Record<string, unknown>
).createWorkspaceAgentChatPlugin;
const options = {
  appId: "scheduler",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  // Sibling apps (qualify's auto-chain, U5's approval callback) call this
  // app's actions with A2A JWTs — see packages/shared/src/server/a2a.ts.
  actionRouteAuth: { resolveCaller: resolveA2ACaller },
} satisfies AgentChatPluginOptions;

export default typeof createWorkspaceAgentChatPlugin === "function"
  ? (
      createWorkspaceAgentChatPlugin as (
        options: AgentChatPluginOptions,
      ) => unknown
    )(options)
  : createAgentChatPlugin(options);

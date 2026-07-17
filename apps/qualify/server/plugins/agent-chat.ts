import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";
import * as workspaceServer from "@inbound/shared/server";
import actionsRegistry from "../../.generated/actions-registry.js";

const createWorkspaceAgentChatPlugin = (workspaceServer as Record<string, unknown>).createWorkspaceAgentChatPlugin;
const options = {
  appId: "qualify",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
} satisfies AgentChatPluginOptions;

export default typeof createWorkspaceAgentChatPlugin === "function"
  ? (createWorkspaceAgentChatPlugin as (options: AgentChatPluginOptions) => unknown)(options)
  : createAgentChatPlugin(options);

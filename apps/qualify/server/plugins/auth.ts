import { createAuthPlugin } from "@agent-native/core/server";

// Qualify owns the public lead-status surface (its SSR shell + anonymous
// read action), so it configures the framework auth plugin directly instead
// of the workspace-shared default. Everything else keeps default behavior.
export default createAuthPlugin({
  publicPaths: [
    "/status",
    "/_agent-native/actions/get-lead-status",
    "/_agent-native/actions/get-journey-funnel-highlight",
    "/_agent-native/actions/get-eval-status",
  ],
});

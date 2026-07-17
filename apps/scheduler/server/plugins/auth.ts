import { createAuthPlugin } from "@agent-native/core/server";

// Scheduler owns the public booking surface for routed leads (page + its
// anonymous read/book actions), so it configures auth directly instead of
// the workspace-shared default. Everything else keeps default behavior.
export default createAuthPlugin({
  publicPaths: [
    "/book",
    "/_agent-native/actions/get-route",
    "/_agent-native/actions/route-slots",
    "/_agent-native/actions/book-lead",
  ],
});

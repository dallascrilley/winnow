// The resolver moved to the workspace shared package
// (packages/shared/src/server/a2a.ts) so scheduler/dispatch can wire the
// same actionRouteAuth surface. This re-export keeps the plugin import local.
export { resolveA2ACaller } from "@inbound/shared/server";

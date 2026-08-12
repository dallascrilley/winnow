---
title: Every app route 404s behind a prod path-prefix gateway — APP_BASE_PATH never set, pages hardcode root-absolute URLs
date: 2026-07-17
category: integration
module: deploy
module_detail: prod runner / workspace gateway
tags: [app-base-path, vite-base, gateway, 404, prod-deploy, nitro]
severity: critical
related: [docs/solutions/database/rds-pg16-requires-ssl.md]
---

# Every app route 404s behind a prod path-prefix gateway — APP_BASE_PATH never set, pages hardcode root-absolute URLs

## Problem

The demo deploys as one container behind a prefix gateway:
`https://host/inbound/<appId>/*` → strip `/inbound` → route by first segment
(`scripts/prod-start.mjs`). Code review (pre-rollout) found the whole public
surface would 404 in prod:

- Framework action mounts (`/_agent-native/actions/*`), Nitro file routes,
  and SSR base-strips only honor the `/<appId>` prefix when the app's base
  path is configured — dev sets `APP_BASE_PATH=/<appId>` +
  `VITE_APP_BASE_PATH=/<appId>` per app (framework workspace-dev CLI,
  netlify.toml), but the ECS path set them **nowhere**.
- Public pages hardcoded root-absolute URLs: the forms SSR page POSTed to
  `/api/submit/…`, the funnel page polled
  `/_agent-native/actions/get-public-funnel`, the booking page fetched
  `/_agent-native/actions/*` — all missing `/inbound/<appId>`, all 404 at
  the ALB (only `/inbound*` is forwarded).
- Baked client-asset URLs (vite base `/`) 404 for the same reason.

The dev gateway masked all of it: it falls back to **Referer-based** routing
for root-absolute fetches, which the prod runner deliberately doesn't do.

## Solution

Three layers, all required (commit b68a2a5 and the forms/analytics/scheduler
fix commits):

1. **Runtime env**: `scripts/prod-start.mjs` sets `APP_BASE_PATH=/<appId>`
   and `VITE_APP_BASE_PATH=/<appId>` on every child's env.
2. **Build-time env**: Dockerfile builds per app with the same vars
   (`RUN for app in …; do APP_BASE_PATH=/$app VITE_APP_BASE_PATH=/$app pnpm --filter "$app" run build; done`)
   so client bundles bake the right asset base.
3. **Page-authored URLs**: server-rendered pages prepend
   `process.env.WORKSPACE_PUBLIC_PREFIX` (`/inbound`) + app base; client-side
   fetches derive the prefix from `window.location.pathname`
   (strip the page suffix — yields `""` direct-dev, `/<appId>` dev-gateway,
   `/inbound/<appId>` prod).

## Why it works

Framework route mounting, SSR strip/rewrite, and vite's asset base all read
the same base-path contract the dev CLI sets automatically; a custom prod
runner must reproduce it explicitly at both build and runtime. Deriving
browser URLs from the request context keeps one build correct for direct,
gateway, and external-prefix shapes.

## Prevention

"Boots + /healthz 200" is not a routing proof — the SSR catch-all 200s any
path. Smoke a real action route and a real public page through the full
external URL before calling a deploy done. Any new public page: never write
a root-absolute fetch/href; derive the base.

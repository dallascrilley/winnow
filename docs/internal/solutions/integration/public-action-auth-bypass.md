---
title: Public action routes also require an explicit auth bypass
date: 2026-07-20
category: integration
module: qualify
severity: critical
tags: [agent-native, actions, authentication, public-status]
---

# Public action routes also require an explicit auth bypass

## Problem

The public status page posted to `get-lead-status`, but the action had no
`requiresAuth: false`. The framework auto-protects actions, so the route
whitelist in `server/plugins/auth.ts` could not make anonymous status polling
work.

## Solution

Declare both the public transport and auth contract on the action:

```ts
http: { method: "POST" },
requiresAuth: false,
```

Keep the action's response capability-keyed and sanitized. For an unknown
capability key, let the status page wait through the normal asynchronous
handoff window, then show an invalid-link state rather than polling forever.

## Why it works

`publicPaths` bypasses the outer page/API guard. Action-route authorization is
separate and defaults to authenticated unless `requiresAuth: false` is set on
the action definition.

## Prevention

For every anonymous action, test the registered action configuration and the
public-page fallback state. Do not infer anonymous action access from a route
whitelist alone.

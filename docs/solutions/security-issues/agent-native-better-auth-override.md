---
title: Agent Native upgrade leaves vulnerable Better Auth override active
date: 2026-07-18
category: security-issues
module: workspace-dependencies
tags: [agent-native, better-auth, pnpm, dependency-audit]
severity: high
---

# Agent Native upgrade leaves vulnerable Better Auth override active

## Problem

`pnpm upgrade:agent-native` completed successfully, but `pnpm why better-auth
--recursive` still resolved `better-auth 1.6.0`. `pnpm audit --audit-level high`
reported one critical and six high advisories even though the installed
`@agent-native/core` package declared `better-auth 1.6.16`.

## What didn't work

Running the supported upgrader once changed non-`latest` manifest pins, but it
did not refresh existing `latest` lockfile resolutions. Updating Agent Native
packages moved core to `0.109.2`, but a workspace override still forced Better
Auth back to `1.6.0`.

## Solution

Inspect `pnpm-workspace.yaml` after the supported upgrade. Remove the stale
`better-auth: "1.6.0"` entry from `overrides` instead of replacing it with a new
override, then refresh through supported package-manager and framework paths:

```bash
pnpm update -r @agent-native/core@latest @agent-native/dispatch@latest \
  @agent-native/scheduling@latest @agent-native/toolkit@latest
pnpm install
pnpm upgrade:agent-native
pnpm why better-auth --recursive
pnpm audit --audit-level high
```

Verify typecheck, all app tests, and every production build before committing.

## Why it works

Core already owns a supported Better Auth version. Removing the obsolete
workspace override lets pnpm resolve that dependency normally; refreshing the
lockfile is separately necessary when manifests already use the moving `latest`
tag.

## Prevention

After every Agent Native upgrade, compare the installed core version with the
registry, inspect `pnpm why better-auth`, and run the high-threshold audit. A
green upgrader receipt alone does not prove that stale overrides or `latest`
lockfile entries were removed.

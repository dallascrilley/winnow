---
title: RDS Postgres 16 rejects framework DB connections — no pg_hba entry, no encryption
date: 2026-07-17
category: database
module: deploy
tags: [rds, postgres, ssl, pg_hba, terraform, ecs]
severity: critical
related: [docs/solutions/integration/prod-prefix-gateway-base-path.md]
---

# RDS Postgres 16 rejects framework DB connections — no pg_hba entry, no encryption

## Problem

First ECS rollout: the app container exited code 1 during boot. CloudWatch
(`/ecs/inbound-demo`) showed:

```
PostgresError: no pg_hba.conf entry for host "172.31.94.225", user "inbound", database "postgres", no encryption
    at scripts/prod-start.mjs:38
```

## What didn't work

Looking for a terraform/RDS knob: nothing in the RDS resource relaxes the
SSL requirement (PG16 enforces encrypted connections by default), and there
was no desire to weaken RDS posture for a demo.

## Solution

Append `?sslmode=require` to every connection URL the container scripts
build (encrypts, skips CA verification — acceptable for RDS without the CA
bundle):

- `scripts/prod-start.mjs`: bootstrap `${DB_BASE}/postgres?sslmode=require`,
  per-app `DATABASE_URL=${DB_BASE}/inbound_${app.id}?sslmode=require`
- `scripts/prod-seed.mjs`: same suffix on all five `postgres()` URLs

postgres.js honors `sslmode` in the URL, so no code/config change was needed
in the framework or terraform (commit e8109ec).

## Why it works

The framework's pg pool (`@agent-native/core/dist/db/client.js`,
`pgPoolOptions`) sets **no `ssl` option**, so connections default to
plaintext and RDS's pg_hba (which only has `hostssl` entries) rejects them.
`sslmode=require` makes postgres.js open a TLS connection without needing
the RDS CA bundle on disk.

## Prevention

Any AWS/RDS deploy of an agent-native app: put `?sslmode=require` in
`DATABASE_URL` (and any `*_BASE` used to derive URLs) from the start. Local
SQLite/PG dev URLs are unaffected — these scripts only run in-container.

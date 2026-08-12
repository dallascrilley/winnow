---
title: Local dev infra dies with agent shells — brew PG stale postmaster.pid (recycled PID) and ollama down
date: 2026-07-17
category: developer-experience
module: local-dev
tags: [postgres, brew-services, postmaster-pid, ollama, recovery, macos]
applies_when: [5432 refuses connections after a session/shell crash, anything LLM fails unexpectedly]
---

# Local dev infra dies with agent shells — brew PG stale postmaster.pid (recycled PID) and ollama down

## Problem

Twice in one session, background-shell death cascaded into dev-infra
failure: an eval rerun crashed with `connect ECONNREFUSED 127.0.0.1:5432`,
and ollama (`localhost:11434`) stopped answering. Restarting brew
`postgresql@17` then failed with:

```
FATAL:  lock file "postmaster.pid" already exists
HINT:  Is another postmaster (PID 985) running in data directory "/opt/homebrew/var/postgresql@17"?
```

## What didn't work

`brew services restart postgresql@17` alone — it kept failing on the stale
lock. The trap: `ps -p 985` showed a **live** process, but it was the
1Password browser helper — the dead postmaster's PID had been recycled, so
"PID is alive" does not prove "postmaster is alive".

## Solution

1. Check the pid file's owner, not just liveness:
   `ps -p $(head -1 /opt/homebrew/var/postgresql@17/postmaster.pid) -o comm`
   — if it isn't a postgres process, the lock is stale.
2. `rm /opt/homebrew/var/postgresql@17/postmaster.pid`
3. `brew services restart postgresql@17`, poll `pg_isready -h localhost`
   through "rejecting connections" (crash recovery) to "accepting".
4. `ollama serve` (or restart the app); verify `curl -m 3 localhost:11434/api/tags`.

## Why it works

launchd restarts the service wrapper but postgres refuses to start over a
lock file; PIDs get recycled by unrelated apps on macOS, so only the
process *name* disambiguates.

## Prevention

Dev DBs (`inbound_qualify/scheduler/analytics`) live in brew `postgresql@17`
on **localhost:5432** — the Docker `docker-postgres-1` (pgvector, port
55432) is a different project's; don't "fix" connection failures by
pointing at it. When anything LLM/DB fails after a shell or session crash,
check ollama + brew PG first, before debugging app code.

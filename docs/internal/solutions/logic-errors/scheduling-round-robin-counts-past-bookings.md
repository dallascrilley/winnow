---
title: "@agent-native/scheduling round-robin never rotates — fairness metric only counts bookings whose startTime is in the past"
date: 2026-07-17
category: logic-errors
module: scheduler
tags: [round-robin, scheduling, fairness, routing]
severity: high
---

# @agent-native/scheduling round-robin never rotates — fairness metric only counts bookings whose startTime is in the past

## Problem

Every routed lead was pinned to the priority-1 host ("aria"). Review found
the package's `assign-round-robin-host`
(`@agent-native/scheduling/src/server/bookings-repo.ts`,
`countBookingsByHostInRange`) counts bookings with
`startTime >= now-30d AND startTime < now AND status='confirmed'`. This
app's bookings are always **future-dated**, so every host sits at count 0,
ties resolve to lowest `priority`, and the priority-1 host wins forever.
There is no last-assigned pointer anywhere in the package.

Verified against the live dev DB: 2 confirmed bookings (one future) → the
metric saw only the one whose start time had just flipped into the past.

## Solution

App-side rotation in `apps/scheduler/actions/route-lead.ts` via a pure
helper `apps/scheduler/server/lib/pick-round-robin-host.ts`: count
`lead_routes` rows per `host_email` **for the event type** (our own
assignment history — every assignment writes a row), fewest assignments
wins, ties break by lowest host priority then email for determinism. Unit
tests cover empty history, rotation advancing, and tie-breaks
(`pick-round-robin-host.test.ts`).

## Why it works

The rotation state advances on every *assignment* (a `lead_routes` row is
written at route time), not on the meeting eventually happening in the past.

## Prevention

Don't trust a package metric without checking its window against your data
shape — "counts bookings" meant "counts past bookings". Any future-dated
booking flow composing `@agent-native/scheduling` hits this. Remaining
known gap: two concurrent routes for *different* leads can still pick the
same host (check-then-act; the PK only serializes same-lead retries) —
acceptable at demo scale.

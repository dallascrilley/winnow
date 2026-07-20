---
date: 2026-07-20
topic: visitor-first-ux
origin: conversation design (visitor-first guided journey)
---

# Visitor-first UX: requirements

**Summary:** Make the public inbound demo feel like one guided product (form → live qualification → book → funnel), then densify operator approvals on the same lead truth — without new public PII/identifier leakage.

## Requirements

- R1. A cold visitor can complete form → see live qualification → book (or understand HITL) → find funnel payoff in under 2 minutes without reading the README.
- R2. No healthy public page remains stuck on an SSR loading shell; browser proof is required under the workspace gateway prefix.
- R3. All public fetches and cross-app CTAs are prefix-safe (`""` direct, `/<app>` gateway, `/inbound/<app>` prod).
- R4. Form validation shows inline field errors and focuses the first invalid field (not toast-only first error).
- R5. `talk-to-sales` post-submit continues the guided journey by default; an explicit publisher `redirectUrl` is still honored; `{responseId}` (or successor token placeholder) expands on **both** SSR and React submit paths.
- R6. Status shows honest progress when the lead is not yet created, soft ETA while active, progressive reasoning, and strong terminal CTAs.
- R7. Booking prefills name/email already collected on the lead; does not force re-entry when present.
- R8. Funnel can acknowledge “your submission advanced” via a **short-lived signed journey token**, not a raw `responseId` query param; aggregates stay free of lead identifiers.
- R9. Public visitor chrome does **not** show model name, LLM cost, or eval accuracy (operator/debug only).
- R10. Public status/booking DTOs omit internal ids (`lead.id`) and do not require the client to echo raw transport ids beyond the capability already in the URL path; regression tests cover identifier leakage.
- R11. Sample ICP / mid-band fill (and any seed) is **demo-gated and server-authorized**, not open anonymous mutation.
- R12. Capability URLs use short TTL where newly introduced tokens apply, and public pages set `Referrer-Policy: no-referrer` (or equivalent) so tokens do not leak via Referer.
- R13. Operator approvals remain session-gated and gain dense context + open-visitor-status + keyboard approve/reject without weakening auth.
- R14. Mid-band approve/reject is completable in under ~15 seconds with full reasoning/enrichment visible.

## Scope boundaries

**In:** Public visitor path (forms/qualify/scheduler/analytics public surfaces), journey continuity backend, approvals polish reusing lead timeline, reliability under gateway.

**Out:** Full Dispatch redesign, Slack delivery leg, new ICP model/eval tuning, multi-brand theming, native mobile.

**Deferred:** Side-by-side presenter dual-pane UI, SSE (poll is enough if snappy), bulk approvals.

## Key decisions

- Visitor-first, then operator — not operator-first.
- Reliability before chrome.
- Journey token for cross-app “mine” highlight; existing path capability (`/status/:id`, `/book/:id`) may remain nanoid-based initially if treated as unguessable capabilities, but new query/deep-link surfaces must not mint raw id leakage; public JSON drops `lead.id`.
- Honor configured `redirectUrl`; guided default only when using seed/default talk-to-sales contract.

## Prior learnings applied

- `docs/solutions/integration/prod-prefix-gateway-base-path.md` — never hardcode root-absolute public fetches/hrefs; derive base from path; smoke real actions through full external URL.

## Open questions

- Blocking: none for planning (defaults chosen below).
- Deferred to implementation: exact journey-token crypto home (qualify vs shared package) once U3 starts.

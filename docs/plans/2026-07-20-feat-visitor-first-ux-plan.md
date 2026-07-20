---
date: 2026-07-20
origin: docs/brainstorms/2026-07-20-visitor-first-ux-requirements.md
td_epic: none
---

# Visitor-first guided UX (form → status → book → funnel)

Living document. Update Progress, Surprises, Decision Log, Outcomes as work proceeds.

## Purpose / Big Picture

After this ships, a portfolio visitor experiences **one guided inbound product**: submit talk-to-sales, watch qualification live, book (or understand human review), and see the funnel move — without README narration. Operators get a denser approvals queue on the same lead truth. Public surfaces stay capability-scoped and free of operator telemetry and internal ids.

## Progress

- [x] (2026-07-20) Requirements + plan authored
- [x] (2026-07-20) U1 Reliability investigation + prefix-safe status/CTAs
- [x] (2026-07-20) U2 Form validation + redirect/`{responseId}` parity
- [x] (2026-07-20) U3 Journey token + public DTO hardening
- [x] (2026-07-20) U4 Status hero UX
- [x] (2026-07-20) U5 Booking prefill + slot UX
- [x] (2026-07-20) U6 Funnel journey highlight + shared visitor chrome
- [x] (2026-07-20) U7 Approvals density
- [ ] U8 End-to-end gateway proof + docs

## Surprises & Discoveries

- Observation: Seed already sets `redirectUrl` to `${PUBLIC_URL}/qualify/status/{responseId}`, and **SSR** expands `{responseId}` on success (`apps/forms/server/lib/public-form-ssr.ts`). **React** `FormFillPage` only `assign`s `redirectUrl` literally — no placeholder expansion — so SPA/hydration path can break the guided handoff. Evidence: `FormFillPage.tsx` onSuccess vs SSR replace.
- Observation: Status hardcodes `/_agent-native/actions/...` and `/scheduler/book/...` while funnel/book derive prefix from pathname. Evidence: `status.$responseId.tsx` vs `funnel.tsx` / `book.$responseId.tsx`.
- Observation: Public `get-lead-status` returns `lead.id`, `llmModel`, `llmCostUsd` to anonymous clients. Evidence: `apps/qualify/actions/get-lead-status.ts`.
- Observation: Prior local gateway streaming experiments did **not** establish root cause of analytics/qualify loading-shell hang; treat hydration as measured investigation. Evidence: session history.

## Decision Log

- Decision: Visitor-first guided shell, then operator reuse. Rationale: demo/interview first impression is the product. Date: 2026-07-20.
- Decision: Phase reliability before visual chrome. Rationale: spinner traps make UX work invisible. Date: 2026-07-20.
- Decision: New cross-app “mine” surfaces use **opaque** journey tokens (server hash map); do not add `?mine=<raw responseId>`. Path capabilities (`/status/:responseId`, `/book/:responseId`) remain nanoid unguessable keys initially. Rationale: minimize new leakage while matching existing capability model. Date: 2026-07-20.
- Decision: Strip `lead.id`, `llmModel`, `llmCostUsd`, and eval accuracy from **visitor** UI and narrow public JSON where practical; keep operator views richer. Rationale: privacy + product clarity. Date: 2026-07-20.
- Decision: Honor publisher `redirectUrl` when set; talk-to-sales seed remains the guided default contract. Rationale: forms product already owns redirect settings. Date: 2026-07-20.
- Decision: Sample **values** may be client-only non-persisting autofill on the form (no network). Any **seed** that creates leads/queue rows is auth-gated server action only (operator/presenter session). A public `PUBLIC_DEMO_UX` flag alone must never authorize mutations. Date: 2026-07-20.
- Decision: Journey tokens are **random opaque ids** with a **server-side mapping** (store hash(token) → `{ formResponseId, exp }`). Not signed/base64 JSON containing `frid` (HMAC ≠ confidentiality). Query `j=` residual history/log risk: short TTL; document it. Date: 2026-07-20.

## Outcomes & Retrospective

_Empty until implementation._

## Context and Orientation

### Product path today

| Step | App | Route | Notes |
| --- | --- | --- | --- |
| Submit | forms | `/forms/f/talk-to-sales` | Seeded form; A2A `process-lead` after insert (`lead-router.ts`) |
| Status | qualify | `/qualify/status/:responseId` | Polls `get-lead-status`; publicPaths |
| Book | scheduler | `/scheduler/book/:responseId` | `get-route`, `route-slots`, `book-lead` |
| Funnel | analytics | `/analytics/funnel` | `get-public-funnel` aggregates |
| Approvals | qualify | `/qualify/approvals` | Session-gated HITL |

Gateway shapes (must all work): direct app port, dev workspace gateway, prod `/inbound/<app>` (`docs/solutions/integration/prod-prefix-gateway-base-path.md`).

### Terms

- **Capability URL:** unguessable path key (nanoid response id) authorizing anonymous read/act for that submission only.
- **Journey token:** short-lived **opaque** random id mapped server-side (hash → formResponseId); used for cross-app highlight/CTAs without putting raw ids in novel query params. Integrity comes from lookup existence + TTL, not client-verifiable signatures.
- **Demo gate:** env/flag or authenticated presenter mode enabling sample recipes; off by default in any non-demo deploy posture.

## Requirements

- R1–R14: see `docs/brainstorms/2026-07-20-visitor-first-ux-requirements.md`.

## Key technical decisions

1. **Shared client helper** `apiBaseFromPath(suffixRe)` (or per-app copy matching funnel/book) for every public poll/CTA — never root-absolute `/_agent-native` or `/scheduler/...` on visitor pages. Cite prefix solution doc.
2. **Redirect expansion parity:** implement the same `{responseId}` replace React-side as SSR; optional later journey-token placeholder `{journeyToken}` once U3 exists.
3. **Public DTO allowlist** for status: status, name (first name ok), fitScore, tier, segment, scoreReasoning, proposal (sanitized), enrichment (company-level already used), audit, timestamps — **exclude** `id`, `llmModel`, `llmCostUsd`. Booking context action returns only prefill + host/event fields needed for UI.
4. **Hydration:** spike with browser network/console on gateway; fix the actual root cause (asset base, import map, SSR stream, basename, missing JS error). Do not assume proxy streaming alone.
5. **Referrer-Policy:** set on public status/book/funnel document responses or root public layout.

## Implementation units

### U1. Reliability: prefix-safe status + hydration investigation

- **Goal:** Status and booking CTAs work behind gateway; loading-shell failure has a measured root cause and fix or explicit waived spike notes.
- **Requirements:** R2, R3, R6 (partial honest not-found already exists)
- **Files:**
  - `apps/qualify/app/routes/status.$responseId.tsx`
  - `apps/qualify/app/entry.client.tsx` / root (basename check)
  - `apps/analytics/app/routes/funnel.tsx` (reference pattern)
  - `apps/scheduler/app/routes/book.$responseId.tsx` (reference)
  - Possibly `scripts/prod-start.mjs` only if proven involved
  - Test or smoke notes under `docs/receipts.md` or focused browser script
- **Approach:**
  1. Add pathname-derived `apiBase()` to status (mirror book/funnel). Rewrite `get-lead-status`, `get-eval-status` (if still called), and booking href.
  2. Remove visitor display of eval accuracy/model/cost from status footer as part of same edit if still present (R9) — or gate behind operator session only.
  3. Reproduce loading shell on gateway with browser tools; capture console/network; fix established cause; document if environment-specific.
  4. Acceptance browser: open status URL under gateway prefix, confirm poll 200 and non-empty body text when lead exists.
- **Tests:** unit not required for path helper if tiny; prefer one pure function test if extracted. Browser/manual script required.
- **Verification:** `pnpm --filter qualify exec tsc --noEmit` (or app’s check); gateway curl action 200; browser not stuck on loader for known lead.

### U2. Form validation + redirect placeholder parity

- **Goal:** Inline errors; React submit expands `{responseId}` like SSR; guided handoff reliable on SPA path.
- **Requirements:** R4, R5, R1
- **Files:**
  - `apps/forms/app/pages/FormFillPage.tsx`
  - `apps/forms/server/lib/public-form-ssr.ts` (parity reference only unless shared helper)
  - Optional extract `expandRedirectUrl(url, { responseId })` shared util under `apps/forms`
  - `apps/forms` tests near existing public-settings specs
- **Approach:**
  1. Change `validate()` to return per-field errors; render under fields; `toast` optional secondary.
  2. On success, use submit response `id` as responseId; `redirectUrl.replaceAll("{responseId}", encodeURIComponent(id))` before assign; if no redirectUrl, keep success message.
  3. Do not override an absolute external redirectUrl publisher set deliberately.
  4. Optional **client-only** sample value buttons (ICP / mid-band field presets into React state). No API call. Label as demo helpers. Do **not** treat env flags as authorization for creating leads; queue-seeding stays U7+ auth’d presenter action if needed.
- **Tests:** expandRedirectUrl unit cases; validation shows multiple fields.
- **Verification:** submit via React path lands on `/qualify/status/<id>`; invalid submit focuses first bad field.

### U3. Journey token + public DTO hardening

- **Goal:** Safe cross-app personalization primitive; status JSON stops leaking internal id and operator telemetry fields.
- **Requirements:** R8, R9, R10, R12
- **Files:**
  - New: `apps/qualify/server/lib/journey-token.ts` (mint random token + hashed lookup row; verify/consume)
  - `apps/qualify/actions/get-lead-status.ts` (DTO allowlist)
  - `apps/forms/server/lib/lead-router.ts` and/or submissions success payload (issue token optional field)
  - `apps/analytics/actions/get-public-funnel.ts` or new `get-journey-funnel-highlight.ts` public action
  - auth `publicPaths` registrations
- **Approach:**
  1. Mint `token = randomBytes(32).toString("base64url")`. Persist only `sha256(token)` → `{ formResponseId, exp }` (qualify DB or memory+table). Client receives opaque token only — **no** embedded frid, **no** HMAC-of-JSON design.
  2. TTL ~2h. Issue when lead exists (status payload `journeyToken` and/or process-lead path). Knowing status path id is enough capability to mint once.
  3. Funnel highlight action: input opaque token → lookup hash → `{ stageLabel, advanced: true }` only.
  4. Referrer-Policy on public docs; document query-token log/history residual; optional later one-time exchange.
  5. Strip `id`, `llmModel`, `llmCostUsd` from get-lead-status; visitor UI never renders them.
  6. Tests: unknown/expired token; public JSON has no `id`/`llmCostUsd`; decoding token string yields no formResponseId.

### U4. Status hero UX

- **Goal:** Status feels live and directive.
- **Requirements:** R1, R6, R9, R12
- **Files:** `apps/qualify/app/routes/status.$responseId.tsx` (+ small components if needed)
- **Approach:** Keep zinc aesthetic consistency; add elapsed timer + soft ETA copy; stronger empty/waiting state; progressive sections; terminal CTAs using prefix-safe book + funnel links (funnel with journey token when present); set referrer policy via meta if root allows; remove public eval footer.
- **Tests:** pure helpers for stageIndex/ETA copy if extracted.
- **Verification:** visual pass on pending / routed / pending_approval / disqualified fixtures.

### U5. Booking prefill + slot UX

- **Goal:** No redundant identity entry; clearer slots.
- **Requirements:** R7, R3
- **Files:**
  - `apps/scheduler/app/routes/book.$responseId.tsx`
  - New action e.g. `apps/scheduler/actions/get-booking-context.ts` **or** extend `get-route` with name/email prefill from qualify A2A/capability
  - Prefer single app-owned action: scheduler already calls qualify for route — add prefill fields server-side without exposing extra PII beyond what book already collects
- **Approach:** Prefill inputs; mark read-only if present; timezone `Intl.DateTimeFormat().resolvedOptions().timeZone` with override; keep host-pinned slots.
- **Tests:** get-route/context returns prefill only for existing route.
- **Verification:** routed lead opens book with name/email filled; confirm still works.

### U6. Funnel highlight + shared visitor chrome

- **Goal:** Shared stepper + personal funnel payoff.
- **Requirements:** R1, R8
- **Files:**
  - Small shared layout component per app **or** duplicated slim header (avoid premature monorepo package unless two copies hurt) — prefer copy-paste slim `DemoChrome` in each public page first matching visual language
  - `apps/analytics/app/routes/funnel.tsx`
- **Approach:** Stepper links prefix-safe; funnel reads `j` query, calls highlight action, pulses matching stage row; CTA submit another.
- **Verification:** after submit+score, funnel banner appears with token.

### U7. Approvals density

- **Goal:** Operator mid-band decision &lt;15s.
- **Requirements:** R13, R14
- **Files:** `apps/qualify/app/routes/approvals.tsx`
- **Approach:** Keep session gate; show enrichment + reasoning + open status (prefix-safe) in new tab; keyboard shortcuts when not typing; busy states unchanged.
- **Verification:** logged-in approve/reject still writes audit; shortcut works.

### U8. E2E proof + docs

- **Goal:** README 2-minute demo matches UI; receipts updated.
- **Requirements:** R1, R2
- **Files:** `README.md`, `docs/receipts.md`, optional `docs/interview-mode.md` note
- **Approach:** Scripted gateway journey (curl + browser); record commands/results in receipts; adjust README step list if chrome renames steps.
- **Verification:** one clean run from seed form through funnel highlight on gateway.

## Worktree & concurrency

- **worktree_slug:** `feat/visitor-first-ux`
- **spine_owner:** self
- **Pre-flight:** run `~/.hub/scripts/worktree-posture.sh --claim feat/visitor-first-ux --surfaces "apps/forms,apps/qualify,apps/scheduler,apps/analytics"` when executing
- **Active conflicts:** none known; no `.todos/` td epic (tracker not initialized)

### Write surfaces

- U1: `apps/qualify/app/routes/status.$responseId.tsx` (+ hydrate targets as found)
- U2: `apps/forms/app/pages/FormFillPage.tsx`, forms tests/util
- U3: qualify actions/lib, analytics action, auth publicPaths
- U4: status route
- U5: scheduler book route + action
- U6: funnel + thin chrome on public pages
- U7: approvals route
- U8: docs

## Prior learnings applied

- `docs/solutions/integration/prod-prefix-gateway-base-path.md` — derive bases; smoke real action URLs through external prefix; APP_BASE_PATH at build+runtime already required for prod.

## Deferred / out of scope

- Slack approval delivery (`docs/slack-wiring.md`)
- SSE/WebSocket status (poll OK if ≤1–2s while active)
- Presenter dual-pane
- Replacing path nanoid capabilities with opaque tokens everywhere (larger migration)
- Dispatch / template chrome redesign
- Auto interview-stack expiry (already separate infra work)

## Open questions

- None blocking. Requirements R8/R11 updated 2026-07-20 to match opaque tokens + client-only sample fill. Token storage: qualify DB table preferred; in-memory only acceptable for single-process demo with documented restart loss.

## Validation and Acceptance (release bar)

1. Gateway: submit talk-to-sales → lands on status with expanded id → lead appears → routed CTA books with prefilled identity → funnel shows journey highlight.
2. Invalid form: inline errors, focus first field, no submit.
3. `get-lead-status` response has no `id`, `llmModel`, `llmCostUsd`.
4. Tampered/expired journey token: no funnel personalization, no 500.
5. Approvals: session required; A/R updates lead; visitor status audit shows human.
6. Public pages: `Referrer-Policy` no-referrer (or meta equivalent) on status/book/funnel documents.
7. Prefix shapes: spot-check action URLs for `/qualify`, `/inbound/qualify` style bases.

## Idempotence and Recovery

- Seeds remain idempotent (`talk-to-sales`).
- Token verify failures are soft on funnel.
- Redirect expansion is pure string replace; safe to retry.
- DTO field removal is backward-compatible for UI we own; no external API contract promised.

## Interfaces and Dependencies

- Existing: `process-lead`, `get-lead-status`, `get-public-funnel`, `get-route`, `route-slots`, `book-lead`, `decide-lead-approval`, forms submit `{ success, id }`.
- New: journey token helpers; optional `get-journey-funnel-highlight`; optional booking prefill fields on `get-route`.
- No new npm dependencies — Node `crypto` only (`randomBytes`, `createHash`).

## Artifacts and Notes

- Requirements: `docs/brainstorms/2026-07-20-visitor-first-ux-requirements.md`
- Prefix bible: `docs/solutions/integration/prod-prefix-gateway-base-path.md`

## Revision History

- 2026-07-20: Initial plan from visitor-first design + codebase evidence.
- 2026-07-20: R8/R11 alignment — opaque server-mapped tokens (not signed JSON); sample fill client-only vs seed auth.

# Hosted Inference Qualification Receipt

Status: **blocked before eval**

- Observed: `2026-07-17`
- Intended provider: OpenAI
- Intended model: `gpt-5-mini-2025-08-07`
- Gate: three 24-case runs, each at least 90% accurate, no more than one
  routing-band disagreement, median latency under 20 seconds, and average cost
  under $0.01 per lead.

## Credential discovery

The discovery gate checked process environment names, project `.env` surfaces,
AWS SSM parameter names, and matching 1Password items without printing secret
values.

- `OPENAI_API_KEY` is present in the process environment.
- The standard AWS SSM namespace does not yet contain an OpenAI key.
- Two candidate 1Password credentials exist.
- The process credential and the organization-labeled candidate both receive
  `401 invalid_api_key`.
- The remaining 1Password candidate authenticates but receives
  `429 insufficient_quota`.

No eval cases were run and no accuracy, latency, stability, or cost claim is
made. U2 remains blocked until a funded credential is available. U3–U6 may
continue because they do not require public hosted scoring; U7 public cutover
must not proceed while this gate is red.

## Error-path hardening

The probe exposed that the provider helper included the upstream response body
in thrown errors. Because provider bodies can contain credential fragments or
other sensitive details, the helper now:

- emits only a small allowlist of known provider error codes/types;
- falls back to `request_failed` for all other upstream values;
- never includes the upstream message/body in the exception; and
- aborts hosted scoring after 60 seconds.

Regression tests cover a missing key, a known provider error, a malicious
token-shaped error code, and the request abort signal. The focused Qualify run
passes 33 tests. The test runner still prints the repository's known transient
CJS/module and close-timeout warnings, but exits 0.

## Unblock procedure

1. Fund or replace the intended OpenAI project credential and remove the stale
   local candidate.
2. Repeat one bounded authenticated probe through `callOpenAI`.
3. Store the working secret in the deployment secret manager without exposing
   it in Terraform state, source, logs, or receipts.
4. Run the unchanged 24-case suite three times and append accuracy, routing
   disagreement, p50/p95 latency, token totals, and cost totals here.

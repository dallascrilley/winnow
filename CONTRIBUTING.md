# Contributing to Winnow

Thanks for taking a look. This monorepo is a portfolio demo of an inbound lead
pipeline with a 24-case model eval suite as a CI gate.

It is composed on `@agent-native/core` workspace templates. See [docs/receipts.md](docs/receipts.md) for scaffold vs hand-written evidence and the root README Provenance section.

## Setup

```bash
pnpm install
cp .env.example .env
# Optional per-app overrides: apps/<app>/.env.example
pnpm dev
```

Node `>=22.22.0` and pnpm `10.14.0` (see `packageManager` in root `package.json`).

Local scoring defaults to Ollama (`qwen3:4b`). Hosted scoring needs
`QUALIFY_LLM_PROVIDER=openai` and `OPENAI_API_KEY`.

## Checks before a PR

```bash
pnpm typecheck
pnpm test
pnpm eval          # offline 24-case gate (no LLM keys)
# Optional when a model is available:
pnpm --filter qualify eval:live
```

Keep changes focused. Stage only the paths you edited.

## App map

| App | Role |
| --- | --- |
| `forms` | Intake form; hands `talk-to-sales` to qualify over signed A2A |
| `qualify` | Enrichment, ICP scoring, HITL review band, eval suite |
| `scheduler` | Round-robin AE routing and booking |
| `analytics` | Funnel metrics and latest eval accuracy |
| `dispatch` | Approval delivery (Slack leg specified, not required for local demo) |

## Package names

Workspace package is `@winnow/shared` (`packages/shared`).
deferred until it can be done without breaking A2A imports. User-facing brand
is Winnow.

## License

MIT - see [LICENSE](LICENSE).

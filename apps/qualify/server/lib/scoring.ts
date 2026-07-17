import type { EnrichmentProfile } from "./enrichment-core.js";

/**
 * ICP scoring via a direct LLM API call (Ollama by default, OpenAI optional)
 * with structured JSON output — deliberately framework-free (no LangChain):
 * one prompt builder, one strict JSON parser, one pricing table, and an
 * injectable caller so tests never touch the network. This is the
 * "direct-API equivalence" the resume claims.
 */

export type Tier = "high" | "medium" | "low";
export type Segment =
  | "smb"
  | "midmarket"
  | "enterprise"
  | "personal"
  | "unknown";

export interface ScoreInput {
  profile: EnrichmentProfile;
  name?: string | null;
  companySize?: string | null;
  message?: string | null;
}

export interface IcpScore {
  fitScore: number;
  tier: Tier;
  segment: Segment;
  reasoning: string;
}

export interface LlmUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export type CallLlm = (
  system: string,
  user: string,
) => Promise<{ text: string; usage: LlmUsage }>;

// gpt-5-mini list pricing at build time: $0.25 / 1M input, $2.00 / 1M output
// (per OpenAI pricing pages, 2026-03). Cached-input discount not modeled —
// the ledger overestimates slightly, which is the safe direction.
const PRICE_PER_TOKEN = { input: 0.25 / 1_000_000, output: 2.0 / 1_000_000 };

export const DEFAULT_MODEL = "gpt-5-mini";

// The band policy (Decision Log #4): >=0.8 auto-route, 0.4–0.8 human review,
// <0.4 disqualify. Encoded once here; the status machine in the actions and
// the U5 approval gate both read it.
export const AUTO_THRESHOLD = 0.8;
export const REVIEW_THRESHOLD = 0.4;

export type ScoreBand = "auto" | "review" | "disqualify";

export function bandForScore(fitScore: number): ScoreBand {
  if (fitScore >= AUTO_THRESHOLD) return "auto";
  if (fitScore >= REVIEW_THRESHOLD) return "review";
  return "disqualify";
}

export interface RoutingProposal {
  band: ScoreBand;
  eventTypeSlug: "discovery" | "deep-dive";
  segment: Segment;
  reason: string;
  evaluatedAt: string;
}

export function proposalFor(
  score: IcpScore,
  now: string = new Date().toISOString(),
): RoutingProposal {
  const band = bandForScore(score.fitScore);
  const eventTypeSlug =
    score.segment === "enterprise" ? "deep-dive" : "discovery";
  const reason =
    band === "auto"
      ? `auto-approved: score ${score.fitScore.toFixed(2)} >= ${AUTO_THRESHOLD}`
      : band === "review"
        ? `human review required: score ${score.fitScore.toFixed(2)} in [${REVIEW_THRESHOLD}, ${AUTO_THRESHOLD})`
        : `auto-disqualified: score ${score.fitScore.toFixed(2)} < ${REVIEW_THRESHOLD}`;
  return {
    band,
    eventTypeSlug,
    segment: score.segment,
    reason,
    evaluatedAt: now,
  };
}

export function buildPrompt(icp: string, input: ScoreInput): string {
  const profileLines = input.profile.personal
    ? `- personal/free email domain (${input.profile.domain})`
    : [
        `- domain: ${input.profile.domain}`,
        `- company: ${input.profile.companyName ?? "unknown"}`,
        `- industry: ${input.profile.industry ?? "unknown"}${input.profile.industryGuessed ? " (guessed from domain, weak signal)" : ""}`,
        `- employees: ${input.profile.employees ?? "unknown"}`,
        `- revenue band: ${input.profile.revenueBand ?? "unknown"}`,
        `- hq: ${input.profile.hq ?? "unknown"}`,
        input.profile.unverified
          ? "- enrichment unverified: no provider match"
          : null,
      ]
        .filter(Boolean)
        .join("\n");

  return [
    "Score this inbound lead for ICP fit.",
    "",
    "ICP definition:",
    '"""',
    icp.trim(),
    '"""',
    "",
    "Lead:",
    profileLines,
    `- name: ${input.name ?? "unknown"}`,
    `- self-reported company size: ${input.companySize ?? "unknown"}`,
    `- message: ${(input.message ?? "").trim() || "(none)"}`,
    "",
    "Rules:",
    ...PROMPT_RULES,
    "",
    'Respond with strict JSON only: {"fit_score": number, "tier": "high"|"medium"|"low", "segment": "smb"|"midmarket"|"enterprise"|"personal"|"unknown", "reasoning": string}',
  ].join("\n");
}

export const SYSTEM_PROMPT =
  "You are an inbound lead qualifier for a B2B SaaS company. You output only strict JSON.";

// The scoring policy block, shared by buildPrompt and the eval promptHash —
// a rules edit must move the eval run id, otherwise a score change becomes
// unattributable (schema comment on eval_runs.prompt_hash).
export const PROMPT_RULES = [
  "- fit_score is 0..1 with two decimals. Reserve >= 0.8 for clear ICP matches.",
  "- Trust discount: a free/consumer email domain means the company cannot be verified. Such leads must stay below 0.80 unless the message shows specific, immediate buying intent with clear budget authority (evaluating now, team named, timeline stated). Vague curiosity, research, or 'no budget approved' from a free address scores 0.40-0.79.",
  "- Personal/free email with no business signals at all: segment=personal, fit_score <= 0.30.",
  "- segment describes the COMPANY, never the message intent: 500+ employees = enterprise, 50-499 = midmarket, 1-49 = smb (even non-buyers like vendors keep their company segment). segment=personal only for non-commercial individuals; segment=unknown when nothing about the company can be known (e.g. gibberish with no usable signals).",
  "- Gibberish or content-free messages: fit_score <= 0.30 regardless of domain quality; a good domain cannot rescue an empty message.",
  "- Vendors pitching their own services — partnerships, reselling, SEO/marketing/agency offers for US — are weak fit regardless of how big or polished the sender sounds: fit_score <= 0.39. A pitch to resell our product is not intent to buy it.",
  "- Unverified enrichment is a weak negative, not an automatic reject.",
  "- reasoning: at most 60 words, plain language, no marketing tone.",
] as const;

const SEGMENTS: Segment[] = [
  "smb",
  "midmarket",
  "enterprise",
  "personal",
  "unknown",
];

export function tierForScore(fitScore: number): Tier {
  if (fitScore >= AUTO_THRESHOLD) return "high";
  if (fitScore >= REVIEW_THRESHOLD) return "medium";
  return "low";
}

export function parseScore(raw: string): IcpScore {
  // Tolerate code fences / surrounding prose by extracting the first {...} block.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM response contained no JSON object");
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;

  const fitScore = Number(parsed.fit_score);
  if (!Number.isFinite(fitScore)) {
    throw new Error(
      `LLM response fit_score is not a number: ${String(parsed.fit_score)}`,
    );
  }
  const clamped = Math.min(1, Math.max(0, fitScore));

  const segment = SEGMENTS.includes(parsed.segment as Segment)
    ? (parsed.segment as Segment)
    : "unknown";
  // Tier is derived from the score, never trusted from the model — one
  // source of truth for the band policy.
  const tier = tierForScore(clamped);

  const reasoning =
    typeof parsed.reasoning === "string" && parsed.reasoning.trim()
      ? parsed.reasoning.trim()
      : "no reasoning provided";

  return { fitScore: clamped, tier, segment, reasoning };
}

export async function callOpenAI(
  system: string,
  user: string,
): Promise<{ text: string; usage: LlmUsage }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — scoring needs a live key (loaded from the app .env or process env)",
    );
  }
  const model = process.env.QUALIFY_LLM_MODEL ?? DEFAULT_MODEL;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  const promptTokens = json.usage?.prompt_tokens ?? 0;
  const completionTokens = json.usage?.completion_tokens ?? 0;
  const costUsd =
    promptTokens * PRICE_PER_TOKEN.input +
    completionTokens * PRICE_PER_TOKEN.output;

  return { text, usage: { model, promptTokens, completionTokens, costUsd } };
}

/**
 * Local inference via Ollama (default demo path — zero quota, offline
 * capable). Cost is recorded as $0 with token counts intact, so the ledger
 * stays honest about what local inference means.
 */
export async function callOllama(
  system: string,
  user: string,
): Promise<{ text: string; usage: LlmUsage }> {
  const model = process.env.QUALIFY_LLM_MODEL ?? "qwen3:4b";
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      format: "json",
      stream: false,
      // Deterministic decoding: a scorer that gives different answers to the
      // same lead twice makes both routing and the U6 eval gate meaningless.
      options: { temperature: 0 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama ${res.status}: ${body.slice(0, 300)} — is \`ollama serve\` running with the model pulled?`,
    );
  }

  const json = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  return {
    text: json.message?.content ?? "",
    usage: {
      model,
      promptTokens: json.prompt_eval_count ?? 0,
      completionTokens: json.eval_count ?? 0,
      costUsd: 0,
    },
  };
}

function defaultCaller(): CallLlm {
  const provider = process.env.QUALIFY_LLM_PROVIDER ?? "ollama";
  return provider === "openai" ? callOpenAI : callOllama;
}

export async function scoreIcp(
  icp: string,
  input: ScoreInput,
  callLlm: CallLlm = defaultCaller(),
): Promise<{ score: IcpScore; usage: LlmUsage }> {
  const { text, usage } = await callLlm(SYSTEM_PROMPT, buildPrompt(icp, input));
  return { score: parseScore(text), usage };
}

import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnrichmentProfile } from "./enrichment-core.js";
import {
  AUTO_THRESHOLD,
  bandForScore,
  buildPrompt,
  callOpenAI,
  parseScore,
  proposalFor,
  REVIEW_THRESHOLD,
  scoreIcp,
} from "./scoring.js";

const profile: EnrichmentProfile = {
  domain: "meridianops.com",
  matched: true,
  personal: false,
  companyName: "Meridian Ops",
  industry: "Software",
  industryGuessed: false,
  employees: 240,
  revenueBand: "10-50M",
  hq: "Austin, TX",
  unverified: false,
  notes: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("bandForScore", () => {
  it("implements the documented thresholds", () => {
    expect(bandForScore(AUTO_THRESHOLD)).toBe("auto");
    expect(bandForScore(AUTO_THRESHOLD - 0.01)).toBe("review");
    expect(bandForScore(REVIEW_THRESHOLD)).toBe("review");
    expect(bandForScore(REVIEW_THRESHOLD - 0.01)).toBe("disqualify");
    expect(bandForScore(0)).toBe("disqualify");
    expect(bandForScore(1)).toBe("auto");
  });
});

describe("parseScore", () => {
  it("parses strict JSON", () => {
    const s = parseScore(
      '{"fit_score": 0.87, "tier": "high", "segment": "midmarket", "reasoning": "clear fit"}',
    );
    expect(s.fitScore).toBe(0.87);
    expect(s.tier).toBe("high");
    expect(s.segment).toBe("midmarket");
    expect(s.reasoning).toBe("clear fit");
  });

  it("tolerates code fences and clamps out-of-range scores", () => {
    const s = parseScore(
      '```json\n{"fit_score": 1.4, "segment": "smb", "reasoning": "x"}\n```',
    );
    expect(s.fitScore).toBe(1);
  });

  it("derives tier from the score, never from the model", () => {
    const s = parseScore(
      '{"fit_score": 0.2, "tier": "high", "segment": "smb", "reasoning": "x"}',
    );
    expect(s.tier).toBe("low");
  });

  it("maps unknown segments to 'unknown'", () => {
    const s = parseScore(
      '{"fit_score": 0.5, "segment": "government", "reasoning": "x"}',
    );
    expect(s.segment).toBe("unknown");
  });

  it("throws on a response with no JSON", () => {
    expect(() => parseScore("I cannot score this.")).toThrow("no JSON");
  });
});

describe("proposalFor", () => {
  it("routes enterprise segments to the deep-dive event type", () => {
    const p = proposalFor({
      fitScore: 0.9,
      tier: "high",
      segment: "enterprise",
      reasoning: "",
    });
    expect(p.band).toBe("auto");
    expect(p.eventTypeSlug).toBe("deep-dive");
  });

  it("explains the band decision in plain language", () => {
    const p = proposalFor({
      fitScore: 0.5,
      tier: "medium",
      segment: "smb",
      reasoning: "",
    });
    expect(p.band).toBe("review");
    expect(p.reason).toContain("0.50");
  });
});

describe("buildPrompt", () => {
  it("embeds the ICP definition and the lead profile", () => {
    const prompt = buildPrompt("OUR ICP PARAGRAPH", {
      profile,
      name: "Pat",
      companySize: "201-500",
      message: "need routing",
    });
    expect(prompt).toContain("OUR ICP PARAGRAPH");
    expect(prompt).toContain("meridianops.com");
    expect(prompt).toContain("240");
    expect(prompt).toContain("201-500");
  });
});

describe("scoreIcp", () => {
  it("uses the injected caller and returns usage", async () => {
    const calls: string[] = [];
    const { score, usage } = await scoreIcp(
      "ICP",
      { profile },
      async (_system, user) => {
        calls.push(user);
        return {
          text: '{"fit_score": 0.91, "segment": "midmarket", "reasoning": "strong ops fit"}',
          usage: {
            model: "fake-model",
            promptTokens: 100,
            completionTokens: 20,
            costUsd: 0.000065,
          },
        };
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("ICP");
    expect(score.fitScore).toBe(0.91);
    expect(score.tier).toBe("high");
    expect(usage.model).toBe("fake-model");
    expect(usage.costUsd).toBeCloseTo(0.000065);
  });

  it("bounds Ollama JSON scoring and disables thinking", async () => {
    vi.stubEnv("QUALIFY_LLM_PROVIDER", "ollama");
    vi.stubEnv("QUALIFY_LLM_MODEL", "qwen3:4b");
    vi.stubEnv("OLLAMA_BASE_URL", "http://ollama.test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content:
            '{"fit_score":0.91,"segment":"midmarket","reasoning":"strong fit"}',
        },
        prompt_eval_count: 100,
        eval_count: 20,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scoreIcp("ICP", { profile });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.think).toBe(false);
    expect(body.options).toEqual({ temperature: 0, num_predict: 256 });
  });
});

describe("callOpenAI", () => {
  it("fails clearly when the API key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(callOpenAI("system", "user")).rejects.toThrow(
      "OPENAI_API_KEY is not set",
    );
  });

  it("redacts upstream error bodies", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-secret-that-must-not-escape");
    vi.stubEnv("QUALIFY_LLM_MODEL", "gpt-5-mini-2025-08-07");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: "Incorrect API key: sk-secret-that-must-not-escape",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        }),
      }),
    );

    const error = await callOpenAI("system", "user").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("OpenAI 401: invalid_api_key");
    expect((error as Error).message).not.toContain("sk-secret");
    expect((error as Error).message).not.toContain("Incorrect API key");
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not trust a token-shaped upstream error code", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-synthetic-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          error: { code: "sk-secret-from-proxy", type: "proxy_error" },
        }),
      }),
    );

    const error = await callOpenAI("system", "user").catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toBe("OpenAI 502: request_failed");
    expect((error as Error).message).not.toContain("sk-secret");
  });
});

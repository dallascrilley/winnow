import { describe, expect, it } from "vitest";

import type { EnrichmentProfile } from "./enrichment-core.js";
import {
  AUTO_THRESHOLD,
  bandForScore,
  buildPrompt,
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
});

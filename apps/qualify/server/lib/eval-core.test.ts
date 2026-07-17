import { describe, expect, it } from "vitest";

import {
  compareCase,
  promptHashFor,
  runIdFor,
  summarize,
  type CaseResult,
} from "./eval-core.js";

const golden = {
  expectedTier: "high",
  expectedSegment: "midmarket",
  expectedShouldRoute: true,
} as const;

describe("compareCase", () => {
  it("passes when all three fields match", () => {
    const r = compareCase(golden, {
      tier: "high",
      segment: "midmarket",
      shouldRoute: true,
    });
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("reports each mismatched field", () => {
    const r = compareCase(golden, {
      tier: "medium",
      segment: "enterprise",
      shouldRoute: false,
    });
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(3);
    expect(r.failures[0]).toContain("tier");
    expect(r.failures[1]).toContain("segment");
    expect(r.failures[2]).toContain("shouldRoute");
  });
});

describe("summarize", () => {
  const results: CaseResult[] = [
    {
      caseId: "a",
      tier: "high",
      segment: "midmarket",
      shouldRoute: true,
      pass: true,
      failures: [],
      tags: ["obvious-fit"],
    },
    {
      caseId: "b",
      tier: "low",
      segment: "personal",
      shouldRoute: false,
      pass: false,
      failures: ["tier"],
      tags: ["poor-fit", "adversarial"],
    },
    {
      caseId: "c",
      tier: "low",
      segment: "personal",
      shouldRoute: false,
      pass: true,
      failures: [],
      tags: ["adversarial"],
    },
  ];

  it("computes overall accuracy", () => {
    const s = summarize(results);
    expect(s.caseCount).toBe(3);
    expect(s.passCount).toBe(2);
    expect(s.accuracy).toBeCloseTo(2 / 3);
  });

  it("breaks accuracy down by tag", () => {
    const s = summarize(results);
    expect(s.byTag["obvious-fit"]).toEqual({
      total: 1,
      passed: 1,
      accuracy: 1,
    });
    expect(s.byTag["adversarial"].total).toBe(2);
    expect(s.byTag["adversarial"].passed).toBe(1);
  });

  it("handles an empty result set", () => {
    expect(summarize([]).accuracy).toBe(0);
  });
});

describe("promptHashFor", () => {
  it("is stable for identical inputs", () => {
    expect(promptHashFor("icp", "sys", [{ id: "x" }])).toBe(
      promptHashFor("icp", "sys", [{ id: "x" }]),
    );
  });

  it("changes when the ICP changes (the visible gate)", () => {
    expect(promptHashFor("icp-a", "sys", [])).not.toBe(
      promptHashFor("icp-b", "sys", []),
    );
  });

  it("changes when the case set changes", () => {
    expect(promptHashFor("icp", "sys", [{ id: "x" }])).not.toBe(
      promptHashFor("icp", "sys", [{ id: "y" }]),
    );
  });
});

describe("runIdFor", () => {
  it("sanitizes model names into stable ids", () => {
    expect(runIdFor("qwen3:4b", "abc123")).toBe("eval_qwen3-4b_abc123");
  });
});

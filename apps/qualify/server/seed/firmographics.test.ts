import { describe, expect, it } from "vitest";

import { generateFirmographics, HAND_AUTHORED } from "./firmographics.js";

describe("generateFirmographics", () => {
  it("is deterministic for a fixed seed", () => {
    expect(generateFirmographics()).toEqual(generateFirmographics());
  });

  it("produces the requested count with unique domains", () => {
    const rows = generateFirmographics(200);
    expect(rows).toHaveLength(200);
    expect(new Set(rows.map((r) => r.domain)).size).toBe(200);
  });

  it("includes the hand-authored fixtures", () => {
    const domains = new Set(generateFirmographics().map((r) => r.domain));
    for (const row of HAND_AUTHORED) expect(domains.has(row.domain)).toBe(true);
  });

  it("keeps revenue bands consistent with headcount for generated rows", () => {
    // Hand-authored fixtures are deliberately plausible exceptions (e.g. an
    // 85-person agency at $1-10M); the generator itself must be consistent.
    const handAuthored = new Set(HAND_AUTHORED.map((r) => r.domain));
    for (const row of generateFirmographics()) {
      if (handAuthored.has(row.domain)) continue;
      if (row.employees < 50)
        expect(["<1M", "1-10M"]).toContain(row.revenueBand);
      else if (row.employees < 500) expect(row.revenueBand).toBe("10-50M");
    }
  });
});

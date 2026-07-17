import { describe, expect, it } from "vitest";

import { buildProfile, extractDomain } from "./enrichment-core.js";

const meridian = {
  companyName: "Meridian Ops",
  industry: "Software",
  employees: 240,
  revenueBand: "10-50M",
  hq: "Austin, TX",
};

describe("extractDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(extractDomain("VP.Sales@MeridianOps.com")).toBe("meridianops.com");
  });

  it("handles missing @", () => {
    expect(extractDomain("not-an-email")).toBe("not-an-email");
  });
});

describe("buildProfile", () => {
  it("returns the matched firmographics row", () => {
    const p = buildProfile("meridianops.com", meridian);
    expect(p.matched).toBe(true);
    expect(p.unverified).toBe(false);
    expect(p.companyName).toBe("Meridian Ops");
    expect(p.employees).toBe(240);
  });

  it("flags free-email domains as personal and unverified", () => {
    const p = buildProfile("gmail.com", undefined);
    expect(p.personal).toBe(true);
    expect(p.unverified).toBe(true);
    expect(p.companyName).toBeNull();
  });

  it("marks domain-token industry guesses as weak signal", () => {
    const p = buildProfile("smithlegal.com", undefined);
    expect(p.matched).toBe(false);
    expect(p.unverified).toBe(true);
    expect(p.industry).toBe("Legal Services");
    expect(p.industryGuessed).toBe(true);
  });

  it("returns honest unknowns when nothing matches", () => {
    const p = buildProfile("xyzzyq123.com", undefined);
    expect(p.matched).toBe(false);
    expect(p.unverified).toBe(true);
    expect(p.industry).toBeNull();
    expect(p.industryGuessed).toBe(false);
  });
});

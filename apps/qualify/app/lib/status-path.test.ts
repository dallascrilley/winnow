import { describe, expect, it } from "vitest";

import {
  apiBaseFromPathname,
  workspacePrefixFromApiBase,
} from "./status-path";

describe("status path helpers", () => {
  it("derives api base for direct, gateway, and prod prefixes", () => {
    expect(apiBaseFromPathname("/status/abc")).toBe("");
    expect(apiBaseFromPathname("/qualify/status/abc")).toBe("/qualify");
    expect(apiBaseFromPathname("/inbound/qualify/status/abc")).toBe(
      "/inbound/qualify",
    );
  });

  it("derives workspace prefix for cross-app links", () => {
    expect(workspacePrefixFromApiBase("")).toBe("");
    expect(workspacePrefixFromApiBase("/qualify")).toBe("");
    expect(workspacePrefixFromApiBase("/inbound/qualify")).toBe("/inbound");
  });
});

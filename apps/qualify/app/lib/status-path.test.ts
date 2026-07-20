import { describe, expect, it } from "vitest";

import {
  apiBaseFromPathname,
  MAX_PENDING_STATUS_POLLS,
  statusLookupState,
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

describe("public status lookup limits", () => {
  it("rejects a link after bounded missing-status polls", () => {
    expect(statusLookupState(MAX_PENDING_STATUS_POLLS - 1)).toBe("pending");
    expect(statusLookupState(MAX_PENDING_STATUS_POLLS)).toBe("invalid");
  });
});

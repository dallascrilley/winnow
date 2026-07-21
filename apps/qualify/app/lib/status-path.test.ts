import { describe, expect, it } from "vitest";

import {
  absoluteCrossAppHref,
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
  it("uses an origin-absolute URL for a sibling app", () => {
    expect(
      absoluteCrossAppHref(
        "http://127.0.0.1:8080",
        "/analytics/funnel?j=opaque",
      ),
    ).toBe("http://127.0.0.1:8080/analytics/funnel?j=opaque");
  });
});

describe("public status lookup limits", () => {
  it("shows a recoverable delay before rejecting a missing-status link", () => {
    expect(statusLookupState(MAX_PENDING_STATUS_POLLS - 1)).toBe("pending");
    expect(statusLookupState(MAX_PENDING_STATUS_POLLS)).toBe("delayed");
    expect(statusLookupState(MAX_PENDING_STATUS_POLLS * 3)).toBe("invalid");
  });
});

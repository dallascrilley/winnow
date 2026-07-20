import { describe, expect, it } from "vitest";

import {
  expandRedirectUrl,
  safeRedirectUrl,
} from "./expand-redirect-url";

describe("expandRedirectUrl", () => {
  it("expands responseId like SSR", () => {
    expect(
      expandRedirectUrl("/qualify/status/{responseId}", {
        responseId: "abc/def",
      }),
    ).toBe("/qualify/status/abc%2Fdef");
  });

  it("expands journeyToken when present", () => {
    expect(
      expandRedirectUrl("/analytics/funnel?j={journeyToken}", {
        journeyToken: "tok+1",
      }),
    ).toBe("/analytics/funnel?j=tok%2B1");
  });

  it("leaves unknown placeholders alone", () => {
    expect(expandRedirectUrl("/x/{other}", { responseId: "1" })).toBe(
      "/x/{other}",
    );
  });
});

describe("safeRedirectUrl", () => {
  it("allows relative paths and https", () => {
    expect(safeRedirectUrl("/qualify/status/x")).toBe("/qualify/status/x");
    expect(safeRedirectUrl("https://example.com/ok")).toBe(
      "https://example.com/ok",
    );
  });

  it("rejects javascript and protocol-relative", () => {
    expect(safeRedirectUrl("javascript:alert(1)")).toBeNull();
    expect(safeRedirectUrl("//evil.example/")).toBeNull();
  });
});

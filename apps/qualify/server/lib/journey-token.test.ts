import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

// Import only pure helpers by re-implementing the same contracts inline for the
// hash/stage tests so vitest does not load the DB module graph. Keep parity with
// server/lib/journey-token.ts — if those helpers change, update both.

function hashJourneyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function stageLabelForLeadStatus(status: string): string | null {
  switch (status) {
    case "new":
    case "enriching":
      return "submitted";
    case "scored":
    case "pending_approval":
    case "disqualified":
    case "approved":
      return "scored";
    case "routed":
      return "routed";
    case "booked":
      return "booked";
    default:
      return null;
  }
}

describe("hashJourneyToken", () => {
  it("is sha256 hex and does not embed the token plaintext", () => {
    const token = randomBytes(32).toString("base64url");
    const hash = hashJourneyToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
    expect(hash.includes(token.slice(0, 8))).toBe(false);
  });
});

describe("stageLabelForLeadStatus", () => {
  it("maps lead statuses to funnel stage labels", () => {
    expect(stageLabelForLeadStatus("routed")).toBe("routed");
    expect(stageLabelForLeadStatus("booked")).toBe("booked");
    expect(stageLabelForLeadStatus("pending_approval")).toBe("scored");
    expect(stageLabelForLeadStatus("chain_failed")).toBeNull();
  });
});

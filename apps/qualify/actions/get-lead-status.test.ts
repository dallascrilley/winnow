import { describe, expect, it, vi } from "vitest";

const { defineAction } = vi.hoisted(() => ({
  defineAction: vi.fn(<T>(definition: T) => definition),
}));

vi.mock("@agent-native/core/action", () => ({ defineAction }));
vi.mock("@agent-native/core/db/schema", () => ({ eq: vi.fn() }));
vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema: { leads: { formResponseId: "formResponseId" } },
}));
vi.mock("../server/lib/journey-token.js", () => ({
  issueJourneyToken: vi.fn(),
}));
vi.mock("../server/lib/leads.js", () => ({ parseAudit: vi.fn() }));

import getLeadStatus from "./get-lead-status.js";

describe("get-lead-status public action", () => {
  it("allows anonymous POST polling for capability-keyed status links", () => {
    expect(getLeadStatus.http).toEqual({ method: "POST" });
    expect(getLeadStatus.requiresAuth).toBe(false);
  });
});

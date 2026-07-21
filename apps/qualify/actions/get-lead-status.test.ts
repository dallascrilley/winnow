import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(action: T) => action,
}));

vi.mock("@agent-native/core/db/schema", () => ({ eq: vi.fn() }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    leads: {
      formResponseId: "formResponseId",
      status: "status",
      name: "name",
      fitScore: "fitScore",
      tier: "tier",
      segment: "segment",
      scoreReasoning: "scoreReasoning",
      proposal: "proposal",
      enrichment: "enrichment",
      audit: "audit",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  },
}));

vi.mock("../server/lib/journey-token.js", () => ({
  issueJourneyToken: vi.fn(),
}));
vi.mock("../server/lib/leads.js", () => ({
  parseAudit: (raw: string | null) => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
}));

import getLeadStatus from "./get-lead-status";

function mockLead(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => rows),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  return query;
}

describe("get-lead-status", () => {
  beforeEach(() => {
    mocks.select.mockReset();
  });

  it("allows anonymous POST polling for capability-keyed status links", () => {
    expect(getLeadStatus.http).toEqual({ method: "POST" });
    expect(getLeadStatus.requiresAuth).toBe(false);
  });

  it("returns only the explicit visitor-safe DTO", async () => {
    const query = mockLead([
      {
        id: "private-lead-id",
        email: "visitor@example.test",
        ownerEmail: "operator@example.test",
        organizationId: "private-org-id",
        llmModel: "internal-model",
        llmCostUsd: 0.12345,
        status: "scored",
        name: "Visitor",
        fitScore: 0.91,
        tier: "high",
        segment: "midmarket",
        scoreReasoning: "Strong fit.",
        proposal: JSON.stringify({
          eventTypeSlug: "discovery",
          reason: "private routing policy",
        }),
        enrichment: JSON.stringify({ company: "Example Co" }),
        audit: JSON.stringify([
          {
            at: "2026-07-20T12:00:00.000Z",
            actor: "agent",
            event: "scored",
            channel: "worker",
            detail: "fit 0.91 [internal-model, $0.12345]",
          },
          {
            at: "2026-07-20T12:00:01.000Z",
            actor: "human",
            event: "status:scored→routed",
            channel: "private-approval",
            detail: "reviewer-only detail",
          },
        ]),
        createdAt: "2026-07-20T12:00:00.000Z",
        updatedAt: "2026-07-20T12:00:01.000Z",
      },
    ]);

    const result = await getLeadStatus.run({ responseId: "response_123" });

    expect(Object.keys(mocks.select.mock.calls[0][0])).toEqual([
      "status",
      "name",
      "fitScore",
      "tier",
      "segment",
      "proposal",
      "audit",
      "createdAt",
    ]);
    expect(result).toEqual({
      found: true,
      lead: {
        status: "scored",
        name: "Visitor",
        fitScore: 0.91,
        tier: "high",
        segment: "midmarket",
        proposal: { eventTypeSlug: "discovery" },
        audit: [
          {
            at: "2026-07-20T12:00:00.000Z",
            actor: "agent",
            event: "Fit assessed",
          },
          {
            at: "2026-07-20T12:00:01.000Z",
            actor: "human",
            event: "Status updated",
          },
        ],
        createdAt: "2026-07-20T12:00:00.000Z",
        journeyToken: null,
      },
    });
  });

  it("drops malformed stored JSON rather than exposing or rejecting it", async () => {
    mockLead([
      {
        status: "scored",
        name: "Visitor",
        fitScore: 0.91,
        tier: "high",
        segment: "midmarket",
        proposal: "{not-json",
        audit: "{not-json",
        createdAt: "2026-07-20T12:00:00.000Z",
      },
    ]);

    const result = await getLeadStatus.run({ responseId: "response_123" });

    expect(result).toMatchObject({
      found: true,
      lead: { proposal: null, audit: [] },
    });
  });
});

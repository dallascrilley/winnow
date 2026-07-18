import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  let projection: Record<string, unknown> = {};

  const rows = [
    {
      id: "lead_1",
      email: "buyer@example.test",
      status: "scored",
      scoreReasoning: "Strong operations fit",
      llmCostUsd: 0.00012,
    },
  ];

  function query() {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      then: (resolve: (value: typeof rows) => unknown) => resolve(rows),
    };
    return builder;
  }

  return {
    getDb: () => ({
      select: vi.fn((selected: Record<string, unknown>) => {
        projection = selected;
        return query();
      }),
    }),
    projection: () => projection,
    reset: () => {
      projection = {};
    },
  };
});

vi.mock("../server/db/index.js", async () => ({
  getDb: dbMock.getDb,
  schema: await vi.importActual("../server/db/schema.js"),
}));

const { default: listLeads } = await import("./list-leads.js");

describe("list-leads action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.reset();
  });

  it("projects scored reasoning together with the cost ledger", async () => {
    const result = await listLeads.run({ limit: 25 });

    expect(dbMock.projection()).toHaveProperty("scoreReasoning");
    expect(result.leads[0]).toMatchObject({
      scoreReasoning: "Strong operations fit",
      llmCostUsd: 0.00012,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(action: T) => action,
}));

vi.mock("@agent-native/core/db/schema", () => ({ desc: vi.fn() }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    evalRuns: {
      accuracy: "accuracy",
      caseCount: "caseCount",
      model: "model",
      createdAt: "createdAt",
    },
  },
}));

import getEvalStatus from "./get-eval-status";

function mockRun(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(async () => rows),
  };
  query.from.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
}

describe("get-eval-status public action", () => {
  beforeEach(() => {
    mocks.select.mockReset();
  });

  it("returns only the documented aggregate public DTO", async () => {
    mockRun([
      {
        accuracy: 0.95,
        caseCount: 20,
        passCount: 19,
        model: "test-model",
        promptHash: "internal-prompt-hash",
        createdAt: "2026-07-20T12:00:00.000Z",
      },
    ]);

    await expect(getEvalStatus.run({})).resolves.toEqual({
      found: true,
      eval: {
        accuracy: 0.95,
        caseCount: 20,
        model: "test-model",
        createdAt: "2026-07-20T12:00:00.000Z",
      },
    });

    expect(Object.keys(mocks.select.mock.calls[0][0])).toEqual([
      "accuracy",
      "caseCount",
      "model",
      "createdAt",
    ]);
  });
});

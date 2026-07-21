import { describe, expect, it, vi } from "vitest";

import getPublicFunnel from "./get-public-funnel";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  isPostgres: vi.fn(() => false),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(action: T) => action,
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
  isPostgres: mocks.isPostgres,
}));

describe("get-public-funnel", () => {
  it("returns a clearly marked aggregate demo when Postgres is unavailable", async () => {
    mocks.isPostgres.mockReturnValue(false);

    const result = await getPublicFunnel.run({});

    expect(result).toMatchObject({
      source: "offline-demo",
      funnel: expect.arrayContaining([
        expect.objectContaining({ stage: "1 submitted" }),
        expect.objectContaining({ stage: "5 booked" }),
      ]),
      eval: expect.objectContaining({ caseCount: expect.any(Number) }),
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

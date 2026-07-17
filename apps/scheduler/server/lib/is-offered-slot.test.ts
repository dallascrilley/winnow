import { describe, expect, it } from "vitest";

import { isOfferedSlot } from "./is-offered-slot.js";

const slots = [
  { start: "2026-07-20T14:00:00.000Z" },
  { start: "2026-07-20T14:30:00.000Z" },
];

describe("isOfferedSlot", () => {
  it("accepts an offered start with the exact event length", () => {
    expect(
      isOfferedSlot(
        slots,
        "2026-07-20T14:00:00.000Z",
        "2026-07-20T14:30:00.000Z",
        30,
      ),
    ).toBe(true);
  });

  it("matches equivalent ISO offset forms", () => {
    expect(
      isOfferedSlot(
        slots,
        "2026-07-20T09:00:00.000-05:00",
        "2026-07-20T09:30:00.000-05:00",
        30,
      ),
    ).toBe(true);
  });

  it("rejects a start that is not an offered slot", () => {
    expect(
      isOfferedSlot(
        slots,
        "2026-07-20T14:15:00.000Z",
        "2026-07-20T14:45:00.000Z",
        30,
      ),
    ).toBe(false);
  });

  it("rejects a duration other than the event length", () => {
    expect(
      isOfferedSlot(
        slots,
        "2026-07-20T14:00:00.000Z",
        "2026-07-20T15:00:00.000Z",
        30,
      ),
    ).toBe(false);
  });

  it("rejects unparseable dates", () => {
    expect(
      isOfferedSlot(slots, "tomorrow", "2026-07-20T14:30:00.000Z", 30),
    ).toBe(false);
    expect(
      isOfferedSlot(slots, "2026-07-20T14:00:00.000Z", "not-a-date", 30),
    ).toBe(false);
  });

  it("rejects when no slots are offered", () => {
    expect(
      isOfferedSlot(
        [],
        "2026-07-20T14:00:00.000Z",
        "2026-07-20T14:30:00.000Z",
        30,
      ),
    ).toBe(false);
  });
});

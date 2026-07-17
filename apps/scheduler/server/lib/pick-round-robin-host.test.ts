import { describe, expect, it } from "vitest";

import {
  pickRoundRobinHost,
  type RoundRobinHost,
} from "./pick-round-robin-host.js";

function host(
  userEmail: string,
  priority: number | null,
  isFixed = false,
): RoundRobinHost {
  return { userEmail, priority, isFixed };
}

describe("pickRoundRobinHost", () => {
  it("empty history picks the priority-1 host", () => {
    const hosts = [
      host("aria@x.test", 2),
      host("ben@x.test", 1),
      host("cato@x.test", 3),
    ];
    expect(pickRoundRobinHost(hosts, {})).toBe("ben@x.test");
  });

  it("rotation advances to the host with fewest assignments", () => {
    const hosts = [host("aria@x.test", 2), host("ben@x.test", 1)];
    expect(pickRoundRobinHost(hosts, { "ben@x.test": 1 })).toBe("aria@x.test");
    expect(
      pickRoundRobinHost(hosts, { "ben@x.test": 1, "aria@x.test": 1 }),
    ).toBe("ben@x.test");
  });

  it("assignment count beats priority", () => {
    const hosts = [host("aria@x.test", 1), host("ben@x.test", 4)];
    expect(pickRoundRobinHost(hosts, { "aria@x.test": 2 })).toBe("ben@x.test");
  });

  it("ties on count break by lowest priority, then email", () => {
    const hosts = [
      host("cato@x.test", 2),
      host("aria@x.test", 2),
      host("ben@x.test", 1),
    ];
    expect(pickRoundRobinHost(hosts, {})).toBe("ben@x.test");
    // Same priority on all — alphabetical for determinism.
    const equal = [host("cato@x.test", 2), host("aria@x.test", 2)];
    expect(pickRoundRobinHost(equal, {})).toBe("aria@x.test");
  });

  it("hosts without a priority sort last among ties", () => {
    const hosts = [host("aria@x.test", null), host("ben@x.test", 5)];
    expect(pickRoundRobinHost(hosts, {})).toBe("ben@x.test");
  });

  it("fixed hosts never rotate in", () => {
    const hosts = [host("aria@x.test", 1, true), host("ben@x.test", 2)];
    expect(pickRoundRobinHost(hosts, { "ben@x.test": 5 })).toBe("ben@x.test");
  });

  it("returns null when no host is eligible", () => {
    expect(pickRoundRobinHost([], {})).toBeNull();
    expect(pickRoundRobinHost([host("aria@x.test", 1, true)], {})).toBeNull();
  });
});

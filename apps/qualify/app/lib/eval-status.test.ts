import { describe, expect, it, vi } from "vitest";

import {
  formatPublicEvalStatus,
  loadPublicEvalStatus,
} from "./eval-status";

describe("public eval status", () => {
  it("uses the current app prefix and formats the visible accuracy footer", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        found: true,
        eval: {
          accuracy: 0.9583,
          caseCount: 24,
          model: "qwen3:4b",
          createdAt: "2026-07-20T12:00:00.000Z",
        },
      }),
    });

    const evalStatus = await loadPublicEvalStatus(fetcher, "/inbound/qualify");

    expect(fetcher).toHaveBeenCalledWith(
      "/inbound/qualify/_agent-native/actions/get-eval-status",
      { cache: "no-store" },
    );
    expect(formatPublicEvalStatus(evalStatus!)).toBe(
      "Qualifier accuracy: 96% · 24 golden cases · qwen3:4b · Jul 20",
    );
  });

  it("does not surface unavailable public eval data", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });

    await expect(loadPublicEvalStatus(fetcher, "")).resolves.toBeNull();
  });
});

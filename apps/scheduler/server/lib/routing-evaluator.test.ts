import { describe, expect, it } from "vitest";

import { evaluateRouting, type RoutingValues } from "./routing-evaluator.js";

const rules = [
  {
    id: "rule_enterprise",
    conditions: [
      { fieldId: "segment", op: "equals" as const, value: "enterprise" },
    ],
    action: { kind: "event-type" as const, eventTypeId: "et_deep_dive" },
  },
  {
    id: "rule_ops_message",
    conditions: [
      { fieldId: "segment", op: "equals" as const, value: "midmarket" },
      { fieldId: "message", op: "contains" as const, value: "revops" },
    ],
    action: { kind: "event-type" as const, eventTypeId: "et_discovery" },
  },
];

const fallback = { kind: "custom-message" as const, message: "no fit" };

describe("evaluateRouting", () => {
  it("first matching rule wins", () => {
    const values: RoutingValues = { segment: "enterprise", message: "revops" };
    expect(evaluateRouting(rules, fallback, values)).toEqual({
      matchedRuleId: "rule_enterprise",
      action: rules[0].action,
    });
  });

  it("ANDs conditions within a rule", () => {
    const values: RoutingValues = {
      segment: "midmarket",
      message: "nothing relevant",
    };
    expect(evaluateRouting(rules, fallback, values).matchedRuleId).toBeNull();
  });

  it("falls back when nothing matches", () => {
    expect(evaluateRouting(rules, fallback, { segment: "smb" })).toEqual({
      matchedRuleId: null,
      action: fallback,
    });
  });

  it("matches case-insensitively", () => {
    const values: RoutingValues = { segment: "Enterprise" };
    expect(evaluateRouting(rules, fallback, values).matchedRuleId).toBe(
      "rule_enterprise",
    );
  });

  it("contains works on substrings", () => {
    const values: RoutingValues = {
      segment: "midmarket",
      message: "our RevOps team",
    };
    expect(evaluateRouting(rules, fallback, values).matchedRuleId).toBe(
      "rule_ops_message",
    );
  });

  it("in matches any of several values", () => {
    const inRules = [
      {
        id: "r",
        conditions: [
          { fieldId: "size", op: "in" as const, value: ["51-200", "201-500"] },
        ],
        action: { kind: "event-type" as const, eventTypeId: "et" },
      },
    ];
    expect(
      evaluateRouting(inRules, fallback, { size: "201-500" }).matchedRuleId,
    ).toBe("r");
    expect(
      evaluateRouting(inRules, fallback, { size: "1-10" }).matchedRuleId,
    ).toBeNull();
  });

  it("treats missing fields as non-matching (except not-equals)", () => {
    const neRules = [
      {
        id: "r",
        conditions: [
          { fieldId: "segment", op: "not-equals" as const, value: "personal" },
        ],
        action: { kind: "event-type" as const, eventTypeId: "et" },
      },
    ];
    expect(evaluateRouting(neRules, fallback, {}).matchedRuleId).toBe("r");
    expect(evaluateRouting(rules, fallback, {}).matchedRuleId).toBeNull();
  });
});

import type { RoutingFormRule } from "@agent-native/scheduling/shared";

/**
 * Consumer-side routing-form evaluator — the scheduling package deliberately
 * ships persistence but no server-side rule evaluation (see
 * submit-routing-form-response's doc comment), so this is the app's
 * implementation: conditions ANDed, first matching rule wins, else fallback.
 */

export type RoutingAction = RoutingFormRule["action"];
export type RoutingValues = Record<string, string | string[] | undefined>;

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function conditionMatches(
  condition: RoutingFormRule["conditions"][number],
  values: RoutingValues,
): boolean {
  const actual = asArray(values[condition.fieldId]).map(normalize);
  const expected = condition.value;

  switch (condition.op) {
    case "equals":
      return (
        actual.length > 0 &&
        actual.every((a) => a === normalize(String(expected)))
      );
    case "not-equals":
      return actual.every((a) => a !== normalize(String(expected)));
    case "contains": {
      const needle = normalize(String(expected));
      return actual.some((a) => a.includes(needle));
    }
    case "starts-with": {
      const needle = normalize(String(expected));
      return actual.some((a) => a.startsWith(needle));
    }
    case "in": {
      const options = (Array.isArray(expected) ? expected : [expected]).map(
        normalize,
      );
      return actual.some((a) => options.includes(a));
    }
  }
}

export function evaluateRouting(
  rules: RoutingFormRule[],
  fallback: RoutingAction,
  values: RoutingValues,
): { matchedRuleId: string | null; action: RoutingAction } {
  for (const rule of rules) {
    if (
      rule.conditions.every((condition) => conditionMatches(condition, values))
    ) {
      return { matchedRuleId: rule.id, action: rule.action };
    }
  }
  return { matchedRuleId: null, action: fallback };
}

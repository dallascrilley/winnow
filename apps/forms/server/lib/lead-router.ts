import { signA2AToken } from "@agent-native/core/a2a";

/**
 * Lead-router fork hook (this file + its call site in
 * server/handlers/submissions.ts + the {responseId} redirect expansion in
 * server/lib/public-form-ssr.ts are the only upstream deltas in the forms
 * fork — tracked in docs/receipts.md).
 *
 * After the demo form's response is persisted, hand it to the qualify app's
 * process-lead action with a signed A2A JWT. The framework's A2A agent
 * client is SSRF-guarded and refuses loopback URLs, so workspace siblings
 * can't use invokeAgent in local dev — signed action calls over the gateway
 * are the dev path (qualify verifies via actionRouteAuth).
 *
 * Scoped to the seeded demo form (`talk-to-sales`) with its known field ids
 * so unrelated forms (e.g. embedded feedback) never trigger the chain.
 */

export const LEAD_ROUTER_FORM_SLUG = "talk-to-sales";

export interface LeadRouterSubmission {
  formSlug: string;
  formId: string;
  responseId: string;
  data: Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function qualifyBaseUrl(): string {
  const base = (
    process.env.WORKSPACE_GATEWAY_URL ??
    process.env.APP_URL ??
    "http://127.0.0.1:8080"
  ).replace(/\/$/, "");
  return `${base}/qualify`;
}

export async function dispatchLeadQualification(
  submission: LeadRouterSubmission,
): Promise<void> {
  if (submission.formSlug !== LEAD_ROUTER_FORM_SLUG) return;

  const email = text(submission.data.email);
  if (!email) {
    console.warn(
      `[lead-router] ${LEAD_ROUTER_FORM_SLUG} response ${submission.responseId} has no email field — skipping qualification`,
    );
    return;
  }

  const token = await signA2AToken(
    "forms@inbound-demo.test",
    process.env.WORKSPACE_ORG_DOMAIN ?? "inbound-demo.test",
    undefined,
    { preferGlobalSecret: true },
  );

  const res = await fetch(
    `${qualifyBaseUrl()}/_agent-native/actions/process-lead`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        formResponseId: submission.responseId,
        email,
        name: text(submission.data.name),
        companySize: text(submission.data.company_size),
        message: text(submission.data.message),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `process-lead ${res.status}: ${body.slice(0, 200)} (response ${submission.responseId})`,
    );
  }
}

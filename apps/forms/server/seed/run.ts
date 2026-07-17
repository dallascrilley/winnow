// Seed the published `talk-to-sales` demo form (idempotent by slug). The
// redirectUrl carries the PUBLIC_URL of the deployment so submitters land on
// their live qualify status page — locally http://127.0.0.1:8080, in prod
// https://demos.dallascrilley.com/inbound.

// Import order is load-bearing: evaluating @agent-native/core/scripts runs
// loadEnv(), which loads this app's .env before the schema module picks a
// SQL dialect at load time.
import "@agent-native/core/scripts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "@agent-native/core/db/schema";

const { getDb, schema } = await import("../db/index.js");

const PUBLIC_URL = (process.env.PUBLIC_URL ?? "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const OWNER = process.env.AGENT_USER_EMAIL ?? "dev@local.test";

const fields = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "talk-to-sales-fields.json",
    ),
    "utf8",
  ),
) as unknown[];

const settings = {
  submitText: "Submit",
  successMessage: "Thank you! Your response has been recorded.",
  showProgressBar: false,
  emailOnNewResponses: false,
  redirectUrl: `${PUBLIC_URL}/qualify/status/{responseId}`,
};

const db = getDb();
const existing = await db
  .select({ id: schema.forms.id })
  .from(schema.forms)
  .where(eq(schema.forms.slug, "talk-to-sales"))
  .limit(1);

if (existing[0]) {
  await db
    .update(schema.forms)
    .set({
      fields: JSON.stringify(fields),
      settings: JSON.stringify(settings),
      status: "published",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.forms.id, existing[0].id));
  console.log(`seed: talk-to-sales updated (${existing[0].id})`);
} else {
  const id = `form_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(schema.forms).values({
    id,
    title: "Talk to sales",
    description:
      "Tell us what you're solving — our agent qualifies and routes you to the right person.",
    slug: "talk-to-sales",
    fields: JSON.stringify(fields),
    settings: JSON.stringify(settings),
    status: "published",
    createdAt: now,
    updatedAt: now,
    ownerEmail: OWNER,
    visibility: "public",
  });
  console.log(`seed: talk-to-sales created (${id})`);
}

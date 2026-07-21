// Import order is load-bearing: evaluating @agent-native/core/scripts runs
// loadEnv(), which loads this app's .env (DATABASE_URL) before the schema
// module picks a SQL dialect at load time.
import "@agent-native/core/scripts";
import { randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";

const { getDb, schema } = await import("../db/index.js");
const { AES, DEMO_TZ, EVENT_TYPES, ROUTING_FORM_ID, ROUTING_FORM_NAME } =
  await import("./team.js");

const db = getDb();
const now = new Date().toISOString();
const owner = process.env.AGENT_USER_EMAIL ?? "dev@local.test";

// ── Schedules + availability, one per AE ──────────────────────────────────
for (const ae of AES) {
  const scheduleId = `sched_${ae.email.split("@")[0]}`;
  const existing = await db
    .select({ id: schema.schedules.id })
    .from(schema.schedules)
    .where(eq(schema.schedules.id, scheduleId))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: `${ae.name} — working hours`,
      timezone: DEMO_TZ,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
      // Owned by the AE — the availability engine resolves a host's default
      // schedule by owner email.
      ownerEmail: ae.email,
    });
    // Monday–Friday (day 1–5), staggered window per AE
    for (let day = 1; day <= 5; day++) {
      await db.insert(schema.scheduleAvailability).values({
        id: `sa_${ae.email.split("@")[0]}_${day}`,
        scheduleId,
        day,
        startTime: ae.start,
        endTime: ae.end,
        createdAt: now,
      });
    }
  }
}

// ── Event types + round-robin hosts ───────────────────────────────────────
const eventTypeIds: Record<string, string> = {};

for (const et of EVENT_TYPES) {
  const existing = await db
    .select()
    .from(schema.eventTypes)
    .where(eq(schema.eventTypes.slug, et.slug))
    .limit(1);
  let id = existing[0]?.id as string | undefined;
  if (!id) {
    id = `et_${et.slug.replace("-", "_")}`;
    await db.insert(schema.eventTypes).values({
      id,
      title: et.title,
      slug: et.slug,
      description: et.description,
      length: et.length,
      schedulingType: "round-robin",
      createdAt: now,
      updatedAt: now,
      ownerEmail: owner,
    });
  }
  eventTypeIds[et.slug] = id;

  const hostRows = await db
    .select()
    .from(schema.eventTypeHosts)
    .where(eq(schema.eventTypeHosts.eventTypeId, id));
  const haveHosts = new Set(hostRows.map((h) => h.userEmail));
  for (const [i, ae] of AES.entries()) {
    if (haveHosts.has(ae.email)) continue;
    await db.insert(schema.eventTypeHosts).values({
      eventTypeId: id,
      userEmail: ae.email,
      isFixed: false,
      weight: 1,
      priority: i + 1,
      scheduleId: `sched_${ae.email.split("@")[0]}`,
      createdAt: now,
    });
  }
}

// ── Routing form ──────────────────────────────────────────────────────────
const rfExisting = await db
  .select({ id: schema.routingForms.id })
  .from(schema.routingForms)
  .where(eq(schema.routingForms.id, ROUTING_FORM_ID))
  .limit(1);

if (rfExisting.length === 0) {
  await db.insert(schema.routingForms).values({
    id: ROUTING_FORM_ID,
    name: ROUTING_FORM_NAME,
    description:
      "Maps qualification segments to the right conversation. Evaluated by server/lib/routing-evaluator.ts.",
    fields: JSON.stringify([
      {
        id: "segment",
        name: "segment",
        label: "Segment",
        type: "select",
        required: true,
        options: ["smb", "midmarket", "enterprise", "personal", "unknown"],
      },
    ]),
    rules: JSON.stringify([
      {
        id: "rule_enterprise",
        conditions: [{ fieldId: "segment", op: "equals", value: "enterprise" }],
        action: { kind: "event-type", eventTypeId: eventTypeIds["deep-dive"] },
      },
      {
        id: "rule_default_fit",
        conditions: [
          {
            fieldId: "segment",
            op: "in",
            value: ["smb", "midmarket", "unknown"],
          },
        ],
        action: { kind: "event-type", eventTypeId: eventTypeIds["discovery"] },
      },
    ]),
    fallback: JSON.stringify({
      kind: "event-type",
      eventTypeId: eventTypeIds["discovery"],
    }),
    createdAt: now,
    updatedAt: now,
    ownerEmail: owner,
  });
}

console.log(
  `seed: ${AES.length} AEs, event types ${Object.values(eventTypeIds).join(", ")}, routing form ${ROUTING_FORM_ID}`,
);

// createGetDb owns a private driver pool with no public close hook. This file
// is a CLI entry point, so exit only after every seed write has completed.
process.exit(0);

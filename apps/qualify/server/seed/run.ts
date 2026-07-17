// Import order is load-bearing: evaluating @agent-native/core/scripts runs
// loadEnv(), which loads this app's .env (DATABASE_URL) before the schema
// module picks a SQL dialect at load time.
import "@agent-native/core/scripts";
import { eq, inArray } from "@agent-native/core/db/schema";

const { getDb, schema } = await import("../db/index.js");
const { generateFirmographics } = await import("./firmographics.js");
const { DEFAULT_ICP, ICP_SETTING_KEY } = await import("../lib/leads.js");

const db = getDb();
const rows = generateFirmographics();

const existing = await db
  .select({ domain: schema.firmographics.domain })
  .from(schema.firmographics)
  .where(
    inArray(
      schema.firmographics.domain,
      rows.map((r) => r.domain),
    ),
  );
const have = new Set(existing.map((r) => r.domain));
const missing = rows.filter((r) => !have.has(r.domain));

if (missing.length > 0) {
  await db.insert(schema.firmographics).values(missing);
}

// Portable upsert for the single-row ICP setting: delete the key + insert.
await db
  .delete(schema.qualifySettings)
  .where(eq(schema.qualifySettings.key, ICP_SETTING_KEY));
await db.insert(schema.qualifySettings).values({
  key: ICP_SETTING_KEY,
  value: DEFAULT_ICP,
  updatedAt: new Date().toISOString(),
});

console.log(
  `seed: firmographics ${rows.length} total (${missing.length} inserted), icp_definition set`,
);

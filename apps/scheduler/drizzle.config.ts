import { defineConfig } from "drizzle-kit";

// The schema helpers pick dialect from DATABASE_URL at load time, not from
// this config. Regenerate with DATABASE_URL unset (or a sqlite file URL);
// a postgres:// DATABASE_URL here silently yields "0 tables".
export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: "sqlite",
});

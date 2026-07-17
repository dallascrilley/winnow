import { defineConfig } from "drizzle-kit";

// The schema helpers pick dialect from DATABASE_URL at load time, not from
// this config. Regenerate with a postgres:// DATABASE_URL set, e.g.:
//   DATABASE_URL=postgres://localhost:5432/inbound_qualify \
//     pnpm exec drizzle-kit generate --config=drizzle.pg.config.ts
export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations-pg",
  dialect: "postgresql",
});

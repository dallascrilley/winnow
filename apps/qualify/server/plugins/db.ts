import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
} from "@agent-native/core/db";

import { schema } from "../db/index.js";
// Generated from the drizzle-kit .sql output (see migrations-sql.ts header).
import { initPostgres, initSqlite } from "../db/migrations-sql.js";

function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

const runQualifyMigrations = runMigrations(
  [
    {
      version: 1,
      name: "init-qualify",
      sql: { sqlite: initSqlite, postgres: initPostgres },
    },
  ],
  { table: "qualify_migrations" },
);

export default async (nitroApp: any): Promise<void> => {
  await runQualifyMigrations(nitroApp);
  try {
    const summary = await ensureAdditiveColumns({
      db: getDbExec(),
      tables: schemaTables,
    });
    if (summary.errors.length > 0) {
      console.warn(
        "[db] ensureAdditiveColumns completed with errors:",
        summary.errors,
      );
    }
  } catch (err) {
    console.warn(
      "[db] ensureAdditiveColumns failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
};

import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
} from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server";

import { schema } from "../db/index.js";
// Generated from the drizzle-kit .sql output (see migrations-sql.ts header).
import { migrationsSql } from "../db/migrations-sql.js";
import {
  initSchedulingContext,
  isSchedulingContextSet,
} from "../scheduling-context.js";

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

const runSchedulerMigrations = runMigrations(
  migrationsSql.map((m) => ({
    version: m.version,
    name: m.name,
    sql: { sqlite: m.sqlite, postgres: m.postgres },
  })),
  { table: "scheduler_migrations" },
);

export default async (nitroApp: any): Promise<void> => {
  // The action CLI also imports this plugin (runner convention) after
  // actions/run.ts has already set the context with its env-scoped resolver —
  // don't clobber that with the request-scoped resolver outside a request.
  if (!isSchedulingContextSet()) {
    initSchedulingContext(() => getRequestUserEmail());
  }
  await runSchedulerMigrations(nitroApp);
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

const SSL_MODES = new Set(["require", "disable"]);

/**
 * Build one database URL from the deployment's database-less Postgres base.
 * Standard defaults to TLS; lite must opt out explicitly for its private
 * Compose network.
 */
export function buildDatabaseUrl(base, databaseName, sslmode = "require") {
  if (!SSL_MODES.has(sslmode)) {
    throw new Error("DATABASE_SSLMODE must be require or disable");
  }
  if (!/^[a-z][a-z0-9_]*$/.test(databaseName)) {
    throw new Error("database name contains unsupported characters");
  }

  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error("DATABASE_URL_BASE must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL_BASE must use postgres or postgresql");
  }
  if (url.pathname && url.pathname !== "/") {
    throw new Error("DATABASE_URL_BASE must not include a database name");
  }
  if (url.hash) {
    throw new Error("DATABASE_URL_BASE must not include a fragment");
  }

  url.pathname = `/${databaseName}`;
  url.searchParams.set("sslmode", sslmode);
  return url.toString();
}

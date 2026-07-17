import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDatabaseUrl } from "./database-url.mjs";

describe("buildDatabaseUrl", () => {
  it("builds all five application database URLs with TLS required by default", () => {
    const base = "postgres://inbound:password@db.example.test:5432";

    for (const appId of [
      "analytics",
      "dispatch",
      "forms",
      "qualify",
      "scheduler",
    ]) {
      assert.equal(
        buildDatabaseUrl(base, `inbound_${appId}`),
        `${base}/inbound_${appId}?sslmode=require`,
      );
    }
  });

  it("supports explicit non-TLS local Postgres connections", () => {
    assert.equal(
      buildDatabaseUrl(
        "postgres://inbound:password@postgres:5432/",
        "inbound_forms",
        "disable",
      ),
      "postgres://inbound:password@postgres:5432/inbound_forms?sslmode=disable",
    );
  });

  it("preserves base query parameters and replaces an existing sslmode", () => {
    assert.equal(
      buildDatabaseUrl(
        "postgres://inbound:password@db.example.test:5432?application_name=inbound&sslmode=prefer",
        "postgres",
      ),
      "postgres://inbound:password@db.example.test:5432/postgres?application_name=inbound&sslmode=require",
    );
  });

  it("rejects unsupported SSL modes", () => {
    assert.throws(
      () =>
        buildDatabaseUrl(
          "postgres://inbound:password@db.example.test:5432",
          "inbound_qualify",
          "prefer",
        ),
      /DATABASE_SSLMODE must be require or disable/,
    );
  });

  it("rejects a base URL that already names a database", () => {
    assert.throws(
      () =>
        buildDatabaseUrl(
          "postgres://inbound:password@db.example.test:5432/existing",
          "inbound_qualify",
        ),
      /must not include a database name/,
    );
  });
});

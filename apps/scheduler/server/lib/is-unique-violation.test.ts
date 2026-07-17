import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "./is-unique-violation.js";

describe("isUniqueViolation", () => {
  it("matches postgres SQLSTATE 23505", () => {
    const err = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "bookings_host_email_start_time_confirmed_unique"',
      ),
      { code: "23505" },
    );
    expect(isUniqueViolation(err)).toBe(true);
    expect(
      isUniqueViolation(err, "bookings_host_email_start_time_confirmed_unique"),
    ).toBe(true);
    expect(isUniqueViolation(err, "lead_routes")).toBe(false);
  });

  it("matches libsql UNIQUE constraint messages", () => {
    const err = new Error(
      "UNIQUE constraint failed: lead_routes.form_response_id",
    );
    expect(isUniqueViolation(err, "lead_routes")).toBe(true);
    expect(isUniqueViolation(err, "bookings")).toBe(false);
  });

  it("libsql names columns, not the index — marker must cover both dialects", () => {
    // Real sqlite text for the slot guard; postgres names the index instead.
    const sqliteErr = new Error(
      "UNIQUE constraint failed: bookings.host_email, bookings.start_time",
    );
    const pgErr = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "bookings_host_email_start_time_confirmed_unique"',
      ),
      { code: "23505" },
    );
    expect(isUniqueViolation(sqliteErr, "host_email")).toBe(true);
    expect(isUniqueViolation(pgErr, "host_email")).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

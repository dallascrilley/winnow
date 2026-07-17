-- Backstop against two leads booking the same host+slot (the check-then-act
-- race in book-lead). bookings is package-owned, so this index lives in an
-- app migration and is intentionally NOT in the drizzle snapshots — keeping it
-- out of snapshot-vs-schema diffs stops a future `drizzle-kit generate` from
-- emitting a DROP for an index the TS schema cannot declare.
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_host_email_start_time_confirmed_unique" ON "bookings" USING btree ("host_email","start_time") WHERE "status" = 'confirmed';

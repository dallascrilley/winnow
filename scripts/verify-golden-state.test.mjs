import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { verifyGoldenState } from "./verify-golden-state.mjs";

const DATABASES = [
  "inbound_analytics",
  "inbound_dispatch",
  "inbound_forms",
  "inbound_qualify",
  "inbound_scheduler",
];

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createPackage() {
  const directory = mkdtempSync(join(tmpdir(), "inbound-golden-state-"));
  temporaryDirectories.push(directory);
  const databases = DATABASES.map((name) => {
    const archive = `${name}.dump`;
    const rowCounts = `${name}.rows.tsv`;
    const archiveBody = `archive:${name}`;
    const rowCountsBody = `public.example\t1\n`;
    writeFileSync(join(directory, archive), archiveBody);
    writeFileSync(join(directory, rowCounts), rowCountsBody);
    return {
      name,
      archive,
      archiveBytes: Buffer.byteLength(archiveBody),
      archiveSha256: sha256(archiveBody),
      rowCounts,
      rowCountsSha256: sha256(rowCountsBody),
    };
  });
  const manifest = {
    version: 1,
    packageId: "20260718T091500Z-a1b2c3d4e5f6",
    createdAt: "2026-07-18T09:15:00.000Z",
    source: {
      gitSha: "a".repeat(40),
      imageDigest: `sha256:${"b".repeat(64)}`,
      evalModel: "gpt-5-mini-2025-08-07",
      evalPromptHash: "c".repeat(12),
    },
    databases,
  };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  return { directory, manifest };
}

test("accepts a complete five-database package", () => {
  const { directory } = createPackage();
  const result = verifyGoldenState(directory);
  assert.equal(result.databaseCount, 5);
  assert.equal(result.packageId, "20260718T091500Z-a1b2c3d4e5f6");
});

test("fails closed before restore when an archive is missing", () => {
  const { directory, manifest } = createPackage();
  rmSync(join(directory, manifest.databases[2].archive));
  assert.throws(() => verifyGoldenState(directory), /missing archive/);
});

test("fails closed when an archive checksum changes", () => {
  const { directory, manifest } = createPackage();
  writeFileSync(
    join(directory, manifest.databases[1].archive),
    "x".repeat(manifest.databases[1].archiveBytes),
  );
  assert.throws(
    () => verifyGoldenState(directory),
    /archive checksum mismatch/,
  );
});

test("rejects path traversal and unexpected database names", () => {
  const { directory, manifest } = createPackage();
  manifest.databases[0].archive = "../outside.dump";
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  assert.throws(() => verifyGoldenState(directory), /unsafe archive filename/);

  const second = createPackage();
  second.manifest.databases[0].name = "customer_production";
  writeFileSync(
    join(second.directory, "manifest.json"),
    JSON.stringify(second.manifest),
  );
  assert.throws(
    () => verifyGoldenState(second.directory),
    /database allowlist mismatch/,
  );
});

test("rejects archive symlinks", () => {
  const { directory, manifest } = createPackage();
  const archive = join(directory, manifest.databases[0].archive);
  const target = join(directory, "target.dump");
  rmSync(archive);
  writeFileSync(target, "outside-package-identity");
  symlinkSync(target, archive);
  assert.throws(() => verifyGoldenState(directory), /unsafe archive filename/);
});

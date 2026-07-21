#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_DATABASES = [
  "inbound_analytics",
  "inbound_dispatch",
  "inbound_forms",
  "inbound_qualify",
  "inbound_scheduler",
];

function requireMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`invalid ${label}`);
  }
}

function safePackageFile(directory, filename, label) {
  if (
    typeof filename !== "string" ||
    basename(filename) !== filename ||
    !/^[a-z0-9_.-]+$/.test(filename)
  ) {
    throw new Error(`unsafe ${label} filename`);
  }
  const path = resolve(directory, filename);
  if (!path.startsWith(`${resolve(directory)}/`)) {
    throw new Error(`unsafe ${label} filename`);
  }
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`unsafe ${label} filename`);
    }
  } catch (error) {
    if (error.message.startsWith("unsafe ")) throw error;
  }
  return path;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyGoldenState(packageDirectory) {
  const directory = resolve(packageDirectory);
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
  } catch {
    throw new Error("missing or invalid manifest");
  }

  if (manifest.version !== 1) throw new Error("unsupported manifest version");
  requireMatch(manifest.packageId, /^\d{8}T\d{6}Z-[0-9a-f]{12}$/, "package id");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error("invalid creation time");
  }
  requireMatch(manifest.source?.gitSha, /^[0-9a-f]{40}$/, "Git SHA");
  requireMatch(
    manifest.source?.imageDigest,
    /^sha256:[0-9a-f]{64}$/,
    "image digest",
  );
  requireMatch(
    manifest.source?.evalModel,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    "eval model",
  );
  requireMatch(
    manifest.source?.evalPromptHash,
    /^[0-9a-f]{12}([0-9a-f]{52})?$/,
    "eval prompt hash",
  );

  if (!Array.isArray(manifest.databases)) {
    throw new Error("database allowlist mismatch");
  }
  const names = manifest.databases.map((database) => database.name).sort();
  if (
    names.length !== EXPECTED_DATABASES.length ||
    names.some((name, index) => name !== EXPECTED_DATABASES[index])
  ) {
    throw new Error("database allowlist mismatch");
  }

  for (const database of manifest.databases) {
    const archivePath = safePackageFile(directory, database.archive, "archive");
    const rowCountsPath = safePackageFile(
      directory,
      database.rowCounts,
      "row-count",
    );
    let archiveSize;
    try {
      archiveSize = statSync(archivePath).size;
    } catch {
      throw new Error(`missing archive for ${database.name}`);
    }
    try {
      statSync(rowCountsPath);
    } catch {
      throw new Error(`missing row counts for ${database.name}`);
    }
    if (archiveSize !== database.archiveBytes) {
      throw new Error(`archive size mismatch for ${database.name}`);
    }
    if (sha256File(archivePath) !== database.archiveSha256) {
      throw new Error(`archive checksum mismatch for ${database.name}`);
    }
    if (sha256File(rowCountsPath) !== database.rowCountsSha256) {
      throw new Error(`row-count checksum mismatch for ${database.name}`);
    }
  }

  return {
    databaseCount: manifest.databases.length,
    packageId: manifest.packageId,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const packageDirectory = process.argv[2];
  if (!packageDirectory) {
    console.error("usage: verify-golden-state.mjs <package-directory>");
    process.exitCode = 2;
  } else {
    try {
      const result = verifyGoldenState(packageDirectory);
      console.log(
        `verified golden-state package ${result.packageId} (${result.databaseCount} databases)`,
      );
    } catch (error) {
      console.error(`golden-state verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

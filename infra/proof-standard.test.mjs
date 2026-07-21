import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "infra/proof-standard.sh");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakePath() {
  const directory = mkdtempSync(join(tmpdir(), "standard-proof-bin-"));
  temporaryDirectories.push(directory);
  for (const command of ["aws", "docker", "terraform"]) {
    const path = join(directory, command);
    writeFileSync(
      path,
      `#!/bin/sh\necho ${command}-must-not-run >&2\nexit 99\n`,
    );
    chmodSync(path, 0o755);
  }
  return `${directory}:${process.env.PATH}`;
}

function run(args, env = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fakePath(),
      PROOF_ALLOW_DIRTY_FOR_TESTS: "1",
      ...env,
    },
  });
}

test("requires an explicit no-AWS or execute mode", () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /choose --dry-run or --execute/);
});

test("dry-run prints the bounded default-destroy sequence without AWS", () => {
  const result = run(["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /must-not-run/);
  assert.match(result.stdout, /bootstrap standard repositories/);
  assert.match(result.stdout, /push immutable app and Ollama images/);
  assert.match(result.stdout, /run production seed and fresh offline eval/);
  assert.match(result.stdout, /run planted-lead smoke/);
  assert.match(result.stdout, /terraform destroy/);
  assert.match(result.stdout, /write verified sanitized receipt/);
});

test("execute mode requires the destructive cost confirmation", () => {
  const result = run(["--execute"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PROOF_CONFIRM=apply-standard-and-destroy/);
  assert.doesNotMatch(result.stderr, /must-not-run/);
});

test("interview retention requires a second explicit confirmation", () => {
  const result = run(["--dry-run", "--keep-for-interview"]);
  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /KEEP_STANDARD_CONFIRM=retain-standard-for-at-most-24-hours/,
  );

  const confirmed = run(["--dry-run", "--keep-for-interview"], {
    KEEP_STANDARD_CONFIRM: "retain-standard-for-at-most-24-hours",
  });
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stdout, /retention deadline:/);
  assert.match(confirmed.stdout, /terraform -chdir=infra destroy/);
  assert.match(confirmed.stdout, /latest.json is not updated until teardown/);
});

test("arms automatic teardown before the first cost-incurring apply", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const armed = source.indexOf("STACK_CREATED=1");
  const firstApply = source.indexOf(
    "apply -auto-approve -input=false -var=bootstrap_images=true",
  );
  assert.ok(armed > 0 && armed < firstApply);
  assert.match(
    source,
    /if \[\[ \$PROOF_SUCCEEDED == 0 \|\| \$KEEP_FOR_INTERVIEW == 0 \]\]; then[\s\S]*destroy_standard/,
  );
});

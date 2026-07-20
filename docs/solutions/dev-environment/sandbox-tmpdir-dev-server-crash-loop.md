# Dev server crash-loop + machine-wide fork exhaustion from sandbox-owned TMPDIR

**Date:** 2026-07-20 · **Severity:** machine-level (every `fork`/`posix_spawn`
for the user returned EAGAIN; even `true` failed) · **Time lost:** ~1 h

## Symptom

- `pnpm dev` gateway on :8080 answered, but child apps (analytics, qualify,
  scheduler) returned 502 forever.
- Dev log showed each child dying at pnpm snapshot bootstrap and retrying
  every 10 s:
  `Error: ENOENT ... lstat '/private/var/folders/.../T/.ctx-mode-XXXXXX'`
  (stack through `temp-dir` → `tempy` → pnpm `binary-fetcher`).
- After ~40 min of churn: `fork: Resource temporarily unavailable` /
  `spawn /bin/zsh EAGAIN` from *every* tool that spawns a process, including
  the sandbox that caused it. `ps` showed only ~590 processes against a
  5,333 limit — the exhausted resource was per-user threads/spawn slots, not
  the process count.

## Root cause

The dev server was launched from inside a context-mode (`ctx_execute`)
sandbox call. That sandbox exports `TMPDIR=/var/folders/.../T/.ctx-mode-XXXX`
and **deletes the directory when the call ends**. The detached server and
all its children inherited the env var pointing at a now-deleted directory.
pnpm's packaged binary calls `realpathSync(os.tmpdir())` at bootstrap and
crashes on ENOENT → the workspace gateway respawns the app every 10 s →
unbounded process/thread churn → per-user spawn exhaustion that starves
every other tool, including the kill you need to stop it.

## Fix (in the moment)

1. Fork-free tools still work: `Read` to tail the log (found the ENOENT),
   `Write` to recreate the deleted TMPDIR (stops new crashes at the source).
2. Keep retrying a minimal `pkill -9 -f <server>` — spawn windows open
   briefly as churning children die; one landed kill frees everything.
3. Relaunch with a durable TMPDIR:
   ```bash
   export TMPDIR=/private/var/folders/<per-user>/T/   # or /tmp
   pnpm dev
   ```

## Prevention

- **Never launch long-lived servers from an ephemeral-TMPDIR sandbox**
  (context-mode `ctx_execute`, or anything that scopes TMPDIR to the call).
  Children inherit the env and crash-loop after cleanup.
- If the unrestricted sandbox is the only spawner with localhost network
  access (native Bash sandbox blocks it), explicitly
  `export TMPDIR=<durable path>` before `exec`-ing the server.
- Record the server's PID at launch (`echo $!` to a file) so a later kill
  never depends on process enumeration, which macOS sandboxes may block
  (`pkill: Cannot get process list` via sysmond).
- First 502s from lazily-booted workspace apps are normal cold-boot; a
  10s-cadence *repeating* 502 with a growing log is the crash-loop signature
  — check the log for ENOENT on a temp path before suspecting app code.

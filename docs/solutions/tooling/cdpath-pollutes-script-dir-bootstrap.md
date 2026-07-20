# CDPATH pollutes `SCRIPT_DIR="$(cd … && pwd)"` bootstrap

**Date:** 2026-07-20 · **Severity:** high (every `infra/interview.sh`
subcommand died before any AWS work) · **Module:** `infra/*.sh`

## Problem

```text
infra/interview.sh: line 18: cd: $'/Users/.../infra\n/Users/.../infra/..': No such file or directory
```

With `CDPATH` set (this machine: `.:~:~/Code:/Volumes`), the classic bootstrap:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
```

captures a **multi-line** `SCRIPT_DIR`. Under CDPATH, a successful `cd` to a
relative path **prints the resolved directory to stdout** before `pwd` runs, so
the command substitution becomes:

```text
/Users/.../inbound/infra
/Users/.../inbound/infra
```

The next `cd "$SCRIPT_DIR/.."` then tries to enter a path that literally
contains a newline and fails. `bash -x` shows the doubled value clearly.

## What didn't work

- Assuming the script was fine because `bash -n` and shellcheck were clean —
  neither catches CDPATH interaction.
- Running under a clean login shell without noticing the agent/shell inherited
  `CDPATH` from the operator profile.

## Solution

Neutralize CDPATH **inside** the capture, and prefer `--` on `cd`/`dirname`:

```bash
SCRIPT_DIR="$(unset CDPATH; cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(unset CDPATH; cd -- "$SCRIPT_DIR/.." && pwd)"
```

Same pattern for one-shot chdir scripts:

```bash
unset CDPATH
cd -- "$(dirname -- "$0")/.."
```

Landed in `infra/interview.sh` and `infra/push-images.sh` (`ce576ad`).

## Why it works

`unset CDPATH` in the subshell (or before `cd`) stops bash from printing the
destination on successful relative `cd`. Only `pwd` writes to stdout, so the
capture is a single absolute path.

## Prevention

- Never use bare `$(cd "$(dirname …)" && pwd)` in scripts that may run under an
  operator shell with `CDPATH`.
- When a path error shows `$'\n'` inside the path, suspect CDPATH (or any other
  stdout noise inside the capture) before blaming the filesystem.
- Smoke-test scripts with `env CDPATH='.:~:~/Code' ./script status` once after
  writing path bootstrap.

---
title: SSM CLI output can split one database password into two values
date: 2026-07-18
category: database
module: inbound-lite-runtime
tags: [aws-ssm, docker-secrets, postgres, trailing-newline]
severity: high
---

# SSM CLI output can split one database password into two values

## Problem

The lite PostgreSQL container was healthy, but the app restarted with
`password authentication failed for user "inbound"` (`28P01`). Both containers
mounted the same generated secret file, so the failure initially looked like a
stale volume or incorrectly rotated password.

## What didn't work

Restarting Compose and re-reading the same SSM parameter did not help. The
secret bytes were consistently written with a trailing newline because shell
redirection captured the AWS CLI's output terminator.

## Solution

Capture the SSM value through command substitution, validate it, and write it
with `printf '%s'` as implemented in `infra/lite/deploy.sh:32`-`48`:

```bash
parameter_value=$(aws ssm get-parameter \
  --name "$PARAMETER_PREFIX/$name" \
  --with-decryption \
  --region "$region" \
  --query Parameter.Value \
  --output text)
printf '%s' "$parameter_value" > "$output"
```

Keep the resulting file mode `0400`. Do not print the value while diagnosing
or verifying the fix.

## Why it works

PostgreSQL's Docker entrypoint strips the newline from
`POSTGRES_PASSWORD_FILE` (`infra/lite/runtime/compose.yaml:7`-`12`), while the
app reads and URL-encodes the full file (`infra/lite/runtime/app-entrypoint.sh:19`-`24`).
Direct CLI redirection therefore gave PostgreSQL `password` but the app
`password%0A`. Command substitution removes trailing newlines, and `printf`
writes identical bytes for both consumers.

## Prevention

Treat CLI text output as a presentation format, not a byte-exact secret file.
For every generated secret consumed by multiple runtimes, test the exact file
bytes or assert a newline-free write path. Never log or diff the secret itself.

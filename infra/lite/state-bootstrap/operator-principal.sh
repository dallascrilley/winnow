#!/usr/bin/env bash
# Resolve the active AWS session to the stable IAM user or role ARN used by S3 policy.
set -euo pipefail

caller_arn=$(aws sts get-caller-identity --query Arn --output text)

case "${caller_arn}" in
  arn:*:sts::*:assumed-role/*)
    role_name=${caller_arn#*:assumed-role/}
    role_name=${role_name%%/*}
    aws iam get-role --role-name "${role_name}" --query 'Role.Arn' --output text
    ;;
  arn:*:iam::*:user/* | arn:*:iam::*:role/*)
    printf '%s\n' "${caller_arn}"
    ;;
  *)
    echo "active AWS identity is not an IAM user or role session" >&2
    exit 1
    ;;
esac

# Security Policy

## Supported versions

This repository is a public portfolio demo. Security fixes land on `main` only.

## Reporting a vulnerability

Email **dallas@dallascrilley.com** with a description, impact, and steps to
reproduce. Do not open a public issue for unfixed vulnerabilities.

I aim to acknowledge within a few business days and to ship a fix or mitigation
when the report is confirmed.

## Scope notes

- Demo data is synthetic. Do not put real customer PII into a public deploy.
- Secrets belong in environment variables or a secret manager (SSM in the AWS
  layout). Never commit `.env` files or API keys.
- Cross-app calls use signed A2A JWTs (`A2A_SECRET`). Rotate that secret if it
  leaks.
- The public funnel and status pages intentionally expose aggregate metrics and
  synthetic lead timelines. They must not expose raw model keys or private
  tokens.

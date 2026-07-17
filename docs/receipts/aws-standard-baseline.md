# AWS Standard Baseline Receipt

This receipt records the recovered standard Inbound deployment before the
hibernating lite profile is built. It is a functional baseline, not a claim
that the standard profile should remain continuously deployed.

## Identity

- Observed: `2026-07-17T20:24:58Z`
- Git revision: `126b610`
- Region: `us-east-1`
- Terraform task-definition revision: `inbound-demo:2`
- Public test path: the ALB HTTP origin at `/inbound`

## Deployed artifacts

| Artifact | Content digest | Compressed size |
| --- | --- | ---: |
| Application | `sha256:c06a765593b2d595d17a2b8c889d50a7614cc9c0e6ef84714657094747f26f9d` | 1,434,008,342 bytes |
| Ollama with `qwen3:4b` | `sha256:9f04498da7c9878ad722b6f67870adf4e215cf8706ade9d65370ea3b4a981a09` | 5,254,276,088 bytes |

The running task definition still references mutable `latest` tags. These
digests identify the artifacts that the green deployment resolved. U3 changes
both profiles to deploy immutable image references.

## Topology observed

- ECS Fargate: Linux ARM64, 2 vCPU, 8 GB RAM, one running task.
- Application container: five Nitro apps behind the production gateway.
- Ollama sidecar: `qwen3:4b`, temperature 0, thinking disabled for scoring,
  output capped at 256 tokens.
- RDS: PostgreSQL 16.13, `db.t4g.micro`, Single-AZ, private, 20 GB gp3.
- ALB target: healthy on application port 8080.
- ECS rollout: `COMPLETED`, desired 1, running 1, pending 0, failed 0.

## Recovery findings

The baseline required more than rebuilding the original image:

1. The stale application image attempted an unencrypted RDS connection; the
   recovered image uses `sslmode=require`.
2. Task-definition revision 1 omitted `PUBLIC_URL`; revision 2 restores the
   production environment contract and uses an Inbound-owned standard-origin
   hostname instead of the shared portfolio hostname.
3. Three CLI-only seed entrypoints retained a private Drizzle pool after all
   work completed; they now exit after awaited writes. The one-off production
   seed completed with both containers exiting 0.
4. The Forms API returns the created form at the top level, while the smoke
   parser expected a nested `form` object. The parser now accepts both shapes.
5. Qwen's default thinking mode generated 1,027 tokens and exceeded the old
   scoring window. The offline request now disables thinking, caps output at
   256 tokens, and has a 180-second abort bound.

The first forced deployment drained the only old task and then stalled with
desired 1, running 0, pending 0. A second force after draining triggered task
placement. This maintenance-window behavior is accepted for proof mode and is
not the lite wake mechanism.

## Verification

| Gate | Result |
| --- | --- |
| `terraform -chdir=infra fmt -check` | Pass |
| `terraform -chdir=infra validate` | Pass |
| `bash -n scripts/smoke.sh` | Pass |
| Qualify focused tests | Pass, 30 tests |
| Production seed | Pass; all awaited writes completed, app and Ollama exited 0 |
| ECS service stability | Pass; rollout complete, one running task, zero failed tasks |
| ALB target health | Pass; healthy |
| `/inbound/healthz` | HTTP 200; analytics, dispatch, forms, qualify, and scheduler all up |
| Planted-lead smoke | Pass; terminal status `routed`, funnel submissions increased to 2 |

The full standard topology is currently modeled at roughly $122–125 per
always-on month, or about $0.17 per running hour, before model API usage. This
is a rate-card estimate, not an AWS invoice. It is the baseline the hibernating
architecture is intended to replace, while retaining the standard profile as
an apply, verify, receipt, and destroy proof lane.

## Deliberate remaining gates

- The standard-origin ACM certificate and DNS record remain pending. No shared
  Cloudflare hostname or public edge route was changed. Functional proof used
  the ALB HTTP origin.
- Standard resources were not destroyed because destructive teardown requires
  a verified lite replacement and explicit approval.
- The hosted-model qualification, immutable image inputs, hibernating EC2
  profile, backup/restore proof, and edge cutover remain subsequent plan units.

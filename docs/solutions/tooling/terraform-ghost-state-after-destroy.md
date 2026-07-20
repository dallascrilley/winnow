# Terraform local state still lists destroyed AWS resources

**Date:** 2026-07-20 · **Severity:** high (next `interview.sh up` would
reconcile against missing IDs) · **Module:** `infra/` interview mode

## Problem

After a successful `terraform destroy` / interview-mode teardown:

- Live AWS probes found **zero** `inbound-demo` resources (ECR, ALB, RDS, ECS
  service, IAM roles, SGs, SSM, ACM, log group all gone; ECS cluster
  `INACTIVE`).
- Local `infra/terraform.tfstate` still listed **34 managed addresses** and
  still emitted outputs (`alb_dns_name`, `public_url`, …).
- `infra/interview.sh status` therefore looked “up” and either hard-died on
  newer missing outputs (`public_prefix`) or printed a dead ALB DNS name.

A subsequent `terraform apply` against that ghost state would try to refresh /
update resources that no longer exist.

## What didn't work

- `terraform refresh` hung long enough to leave a lock and never finished
  pruning the tree (interrupted after 2+ minutes mid-refresh).
- Batch `terraform state rm $(terraform state list)` also hung with no
  progress for minutes on this checkout — not a reliable recovery path when
  *every* address is already gone in AWS.

## Solution

1. **Prove AWS is empty first** (region `us-east-1`, namespaced `inbound-demo`):
   - ECS service not `ACTIVE`/`DRAINING`
   - no ALB named `inbound-demo`
   - (optional deeper check) no RDS / ECR / IAM / SG / SSM under the same name

2. **Preferred recovery** — built into interview mode:

```bash
infra/interview.sh status        # prints GHOST TERRAFORM STATE + fix line
infra/interview.sh purge-ghost   # typed confirm; --yes for scripts
# up also offers auto-purge when it detects ghost state (--yes auto-purges)
```

3. **Manual rewrite** only if the script is unavailable — backup the state
   file (gitignored via `infra/.gitignore` `terraform.tfstate*`), then empty
   it while preserving `lineage` and bumping `serial`:

```python
import json
from pathlib import Path
p = Path("infra/terraform.tfstate")
s = json.loads(p.read_text())
empty = {
    "version": s.get("version", 4),
    "terraform_version": s.get("terraform_version", "1.15.6"),
    "serial": int(s.get("serial") or 0) + 1,
    "lineage": s["lineage"],
    "outputs": {},
    "resources": [],
    "check_results": None,
}
p.write_text(json.dumps(empty, indent=2) + "\n")
```

4. Confirm: `terraform -chdir=infra state list` empty;
   `infra/interview.sh status` → stack-down message, exit 0.

## Why it works

Local state is the only source of truth Terraform trusts. Destroy that did not
clear (or a restore of an old `tfstate` backup) leaves addresses with no cloud
objects. Emptying the file with the same `lineage` and a higher `serial` is
equivalent to “all resources already gone” without asking AWS to delete
anything. Detection uses fixed resource names (`inbound-demo` ALB + ECS
service status), not parsed ALB DNS strings.

Detection returns three outcomes: ghost (safe to purge), not-ghost (live AWS
or empty state), and **indeterminate** when AWS probes fail for auth/network
reasons. Indeterminate must never purge — only `LoadBalancerNotFound` (and a
non-ACTIVE ECS service under working credentials) counts as gone.

## Prevention

- After every `infra/interview.sh down`, count managed addresses in local
  state; if AWS is empty and state is not, auto-purge leftovers.
- `status` must not treat “outputs exist” as “stack is live”; cross-check ALB
  + ECS.
- `up` must offer / auto-purge ghost state before `terraform apply`.
- Never commit `terraform.tfstate*`; keep purge backups gitignored.

## Related

- [[cdpath-pollutes-script-dir-bootstrap]] — same session; path bootstrap broke
  `status` before ghost state was visible.

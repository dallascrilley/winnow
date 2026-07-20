#!/usr/bin/env bash
# Install or refresh the launchd agent that runs check-expiry-notify every 30m.
set -euo pipefail

SCRIPT_DIR="$(unset CDPATH; cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(unset CDPATH; cd -- "$SCRIPT_DIR/.." && pwd)"
LABEL="com.dallas.inbound-interview-expiry"
SRC_PLIST="$SCRIPT_DIR/${LABEL}.plist"
DEST_DIR="${HOME}/Library/LaunchAgents"
DEST_PLIST="$DEST_DIR/${LABEL}.plist"
WRAPPER="$SCRIPT_DIR/check-expiry-notify.sh"
LOG_DIR="${HOME}/.hub/logs"
UID_NUM="$(id -u)"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR %s\n' "$*" >&2; exit 1; }

[ -f "$SRC_PLIST" ] || die "missing $SRC_PLIST"
[ -f "$WRAPPER" ] || die "missing $WRAPPER"
chmod +x "$WRAPPER" "$SCRIPT_DIR/interview.sh"

# Rewrite absolute paths in the installed plist to this machine/user/repo.
mkdir -p "$DEST_DIR" "$LOG_DIR"
python3 - "$SRC_PLIST" "$DEST_PLIST" "$WRAPPER" "$REPO_ROOT" "$HOME" "$LOG_DIR" <<'PY'
import sys
from pathlib import Path
src, dest, wrapper, repo, home, log_dir = (Path(a).resolve() for a in sys.argv[1:7])
text = src.read_text()
# Template is authored for dallascrilley paths; rewrite to current install.
# Longer keys first so nested paths replace cleanly.
replacements = {
    "/Users/dallascrilley/Code/inbound/infra/check-expiry-notify.sh": str(wrapper),
    "/Users/dallascrilley/.hub/logs/inbound-interview-expiry.launchd.log": str(log_dir / "inbound-interview-expiry.launchd.log"),
    "/Users/dallascrilley/Code/inbound": str(repo),
    "/Users/dallascrilley": str(home),
}
for old in sorted(replacements, key=len, reverse=True):
    text = text.replace(old, replacements[old])
dest.write_text(text)
# Fail loud if any unsubstituted template user path remains that isn't ours.
if "/Users/dallascrilley/" in text and str(home) != "/Users/dallascrilley":
    raise SystemExit("unsubstituted /Users/dallascrilley path left in installed plist")
if ".." in text:
    raise SystemExit(f"non-canonical path remained in plist:\n{text}")
print(f"wrote {dest}")
print(f"wrapper={wrapper}")
print(f"repo={repo}")
PY

# bootout if already loaded (ignore failure)
launchctl bootout "gui/${UID_NUM}" "$DEST_PLIST" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$DEST_PLIST"
launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true

say "installed and loaded: $LABEL"
say "  plist : $DEST_PLIST"
say "  wrapper: $WRAPPER"
say "  log   : $LOG_DIR/inbound-interview-expiry.launchd.log"
say "  interval: 1800s (30m)"
say "manual kick: launchctl kickstart -k gui/${UID_NUM}/${LABEL}"
say "uninstall : launchctl bootout gui/${UID_NUM} $DEST_PLIST && rm -f $DEST_PLIST"

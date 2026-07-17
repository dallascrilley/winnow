#!/usr/bin/env sh
set -eu

if ! systemctl is-active --quiet inbound-lite.service; then
  exit 0
fi
running=$(docker inspect --format '{{.State.Running}}' inbound-lite-app-1 2>/dev/null || printf 'false')
if [ "$running" != "true" ]; then
  systemctl restart inbound-lite.service
fi

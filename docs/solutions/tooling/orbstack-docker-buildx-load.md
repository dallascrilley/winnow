---
title: OrbStack — plain docker build never reaches the runtime image store (buildx --load required); buildkit EOF on export is transient
date: 2026-07-17
category: tooling
module: deploy
tags: [orbstack, docker, buildx, ecr, image-push]
applies_when: [docker run/push can't find a just-built image, docker build fails at "exporting to image" on macOS]
---

# OrbStack — plain docker build never reaches the runtime image store (buildx --load required); buildkit EOF on export is transient

## Problem

Two separate Docker-on-OrbStack failures hit the image pipeline:

1. `docker build` succeeded but `docker run` / `docker push` couldn't find
   the image — the build landed in the build cache, not the runtime image
   store.
2. A later `infra/push-images.sh` run compiled everything, then failed at
   the last step: `ERROR: failed to build: failed to receive status: rpc
   error: code = Unavailable desc = error reading from server: EOF`
   (buildkit connection dropped mid-export).

## Solution

1. Build with `docker buildx build --load` (already what
   `infra/push-images.sh` does) so the image materializes in the runtime
   store for run/push.
2. The export EOF is a transient OrbStack/buildkit hiccup — retry the same
   command; layer cache makes the retry cheap.

## Prevention

On this machine, never rely on plain `docker build` output being visible to
`docker run`. Budget a retry for long image exports, and don't conclude the
Dockerfile broke from an export-phase EOF — check which phase failed first.

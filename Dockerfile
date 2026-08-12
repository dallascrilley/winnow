# syntax=docker/dockerfile:1
# Winnow lead-router demo — single-container workspace (all five apps + proxy).
# The ollama scorer runs as a sidecar container in the same ECS task (see infra/).

FROM node:22-bookworm

# NODE_ENV stays unset until runtime — setting it earlier makes pnpm skip
# devDependencies (typescript, @types/node) and both install-prepare and the
# app builds fail.
ENV WORKSPACE_PORT=8080

WORKDIR /workspace

# pnpm via corepack, pinned by the packageManager field.
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

# Manifest layer: install before copying source so code edits don't bust the
# dependency cache. pnpm needs every workspace package manifest present.
# packages/shared is copied in full: its `prepare` script runs tsc at install
# time and fails without its source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/analytics/package.json apps/analytics/package.json
COPY apps/dispatch/package.json apps/dispatch/package.json
COPY apps/forms/package.json apps/forms/package.json
COPY apps/qualify/package.json apps/qualify/package.json
COPY apps/scheduler/package.json apps/scheduler/package.json
COPY packages/shared packages/shared

RUN pnpm install --frozen-lockfile

# Native modules (better-sqlite3, lightningcss, esbuild) build here; bookworm
# ships the toolchain.
COPY . .

# Each app's client+server bundle is built with its /<appId> base path baked
# in, matching the dev/netlify contract. packages/shared was already built by
# its install-time prepare script.
RUN for app in analytics dispatch forms qualify scheduler; do \
      APP_BASE_PATH=/$app VITE_APP_BASE_PATH=/$app pnpm --filter "$app" run build || exit 1; \
    done

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "scripts/prod-start.mjs"]

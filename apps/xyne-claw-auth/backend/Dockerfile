FROM node:22.23.4-slim AS base
WORKDIR /repo

RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    python3 \
    curl \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && rm -rf /var/lib/apt/lists/*

# pnpm workspace build (same pattern as apps/xyne-claw/Dockerfile): the build
# context is the repo root; workspace deps (@xyne/kata-sdk, @xyne/storage,
# xyne-claw-shared) resolve via pnpm instead of per-package npm ci.
FROM base AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/kata-sdk/package.json           packages/kata-sdk/
COPY packages/icons/package.json              packages/icons/
COPY packages/storage/package.json            packages/storage/
COPY packages/shared/package.json             packages/shared/
COPY packages/xyne-claw-shared/package.json   packages/xyne-claw-shared/
COPY apps/xyne-claw-auth/backend/package.json apps/xyne-claw-auth/backend/

# `...` pulls the workspace deps in automatically. --ignore-scripts: only the
# manifests exist at this layer, so prepare/postinstall hooks that need sources
# would fail; the explicit steps after the source COPY do that work instead.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter xyne-claw-auth...

COPY packages/kata-sdk         packages/kata-sdk
COPY packages/icons            packages/icons
COPY packages/storage          packages/storage
COPY packages/shared           packages/shared
COPY packages/xyne-claw-shared packages/xyne-claw-shared
COPY apps/xyne-claw-auth/backend/prisma        apps/xyne-claw-auth/backend/prisma
COPY apps/xyne-claw-auth/backend/tsconfig.json apps/xyne-claw-auth/backend/
COPY apps/xyne-claw-auth/backend/src           apps/xyne-claw-auth/backend/src
COPY apps/xyne-claw-auth/backend/scripts       apps/xyne-claw-auth/backend/scripts
# SandboxTemplate names for the sandbox profile editor's template list (lib/sandbox-templates.ts).
COPY claw-deployments/kata-infra               claw-deployments/kata-infra

WORKDIR /repo/apps/xyne-claw-auth/backend
RUN npx prisma generate
# @xyne/storage, @xyne/shared and @xyne/icons ship built output (dist/);
# --ignore-scripts skipped their prepare hooks, so build them explicitly before
# the typecheck. @xyne/icons is here for its React-free `meta` entrypoint, which
# src/routes/artifact-apps.ts and xyne-claw-shared's react-artifact tool import
# to validate icon names.
RUN pnpm --filter @xyne/storage run build
RUN pnpm --filter @xyne/shared run build
RUN pnpm --filter @xyne/icons run build
RUN npx tsc --noEmit

# Production image
FROM base AS runner
WORKDIR /repo/apps/xyne-claw-auth/backend

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home clawauth

# Grafana's MCP server (a Python wheel carrying the Go binary), installed at build time:
# prod can't reach PyPI and its root filesystem is read-only, so uvx can't fetch it there.
# Keep the version in step with GRAFANA_MCP_VERSION in src/mcp/adapters/grafana.ts.
RUN UV_TOOL_DIR=/opt/mcp-tools UV_TOOL_BIN_DIR=/usr/local/bin UV_CACHE_DIR=/tmp/uv-cache \
    uv tool install mcp-grafana==1.6.1 \
    && test -x /usr/local/bin/mcp-grafana \
    && rm -rf /tmp/uv-cache
ENV MCP_GRAFANA_BIN=/usr/local/bin/mcp-grafana

COPY --from=builder --chown=clawauth:nodejs /repo /repo

USER clawauth

# Isolated MCP server store (see src/mcp/provision.ts). Pinned explicitly so the
# build-time prewarm below and the runtime provisioner agree on one path,
# independent of $HOME. clawauth owns its home, so this is writable at runtime.
ENV MCP_STORE_ROOT=/home/clawauth/.mcp-store

# Prewarm the store: bake the built-in npx MCP servers into an immutable image
# layer so they launch as `node <entrypoint>`. Prod can't install them at runtime
# (read-only root filesystem, npm registry not allowed by the egress proxy), so a
# required server (scripts/prewarm-mcp.ts REQUIRED) that fails to install fails
# the build.
RUN node --import tsx/esm scripts/prewarm-mcp.ts

EXPOSE 3003

ENV NODE_ENV=production

CMD ["node", "--import", "tsx/esm", "src/main.ts"]

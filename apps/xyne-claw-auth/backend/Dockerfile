FROM node:22.22.3-slim AS base
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
COPY packages/storage/package.json            packages/storage/
COPY packages/shared/package.json             packages/shared/
COPY packages/xyne-claw-shared/package.json   packages/xyne-claw-shared/
COPY apps/xyne-claw-auth/backend/package.json apps/xyne-claw-auth/backend/

# `...` pulls the workspace deps in automatically. --ignore-scripts: only the
# manifests exist at this layer, so prepare/postinstall hooks that need sources
# would fail; the explicit steps after the source COPY do that work instead.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter xyne-claw-auth...

COPY packages/kata-sdk         packages/kata-sdk
COPY packages/storage          packages/storage
COPY packages/shared           packages/shared
COPY packages/xyne-claw-shared packages/xyne-claw-shared
COPY apps/xyne-claw-auth/backend/prisma        apps/xyne-claw-auth/backend/prisma
COPY apps/xyne-claw-auth/backend/tsconfig.json apps/xyne-claw-auth/backend/
COPY apps/xyne-claw-auth/backend/src           apps/xyne-claw-auth/backend/src
COPY apps/xyne-claw-auth/backend/scripts       apps/xyne-claw-auth/backend/scripts

WORKDIR /repo/apps/xyne-claw-auth/backend
RUN npx prisma generate
# @xyne/storage ships built output (main: dist/index.js); --ignore-scripts
# skipped its prepare hook, so build it explicitly before the typecheck.
RUN pnpm --filter @xyne/storage run build
RUN pnpm --filter @xyne/shared run build
RUN npx tsc --noEmit

# Production image
FROM base AS runner
WORKDIR /repo/apps/xyne-claw-auth/backend

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home clawauth

COPY --from=builder --chown=clawauth:nodejs /repo /repo

USER clawauth

# Isolated MCP server store (see src/mcp/provision.ts). Pinned explicitly so the
# build-time prewarm below and the runtime provisioner agree on one path,
# independent of $HOME. clawauth owns its home, so this is writable at runtime.
ENV MCP_STORE_ROOT=/home/clawauth/.mcp-store

# Prewarm the store: bake the built-in npx MCP servers into an immutable image
# layer so they launch as `node <entrypoint>` with no request-time npx install
# and no shared-cache corruption. Best-effort — a flaky registry never fails the
# build; the runtime provisioner installs on demand and self-heals.
RUN node --import tsx/esm scripts/prewarm-mcp.ts || true

EXPOSE 3003

ENV NODE_ENV=production

CMD ["node", "--import", "tsx/esm", "src/main.ts"]

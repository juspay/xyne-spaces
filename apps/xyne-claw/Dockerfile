FROM node:22.22.3-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    git \
    zip \
    curl \
    gnupg \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Quarto removed 2026-07-14: its only consumers (pgm-* and workload-* tools)
# are hard-disabled in xyne-claw-shared/src/tools/registry.ts for security
# (process-local rendering of model-controlled documents). ~150MB image
# savings. If those tool sets are ever re-enabled, rendering belongs in the
# SANDBOX image, not here.

# Pre-install @playwright/mcp so per-conversation spawns skip the npx
# cold-start cost. With a global install we can spawn `mcp-server-playwright`
# directly in subagent-tools.ts (≈50ms) instead of `npx -y @playwright/mcp`
# (~5-10s package resolution per call).
RUN npm install -g @playwright/mcp@latest

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true


FROM base AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/kata-sdk/package.json         packages/kata-sdk/
COPY packages/litellm-client/package.json   packages/litellm-client/
COPY packages/storage/package.json          packages/storage/
COPY packages/xyne-claw-shared/package.json packages/xyne-claw-shared/
COPY apps/xyne-claw/package.json            apps/xyne-claw/

# `...` pulls in litellm-client, xyne-claw-shared, and kata-sdk automatically.
# --ignore-scripts: only manifests are present at this cacheable layer, so
# litellm-client's `prepare` build has no sources or tsconfig yet. Its explicit
# build runs after the source COPY below.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter xyne-claw...

COPY packages/kata-sdk         packages/kata-sdk
COPY packages/litellm-client   packages/litellm-client
COPY packages/storage          packages/storage
COPY packages/xyne-claw-shared packages/xyne-claw-shared
COPY apps/xyne-claw/tsconfig.json apps/xyne-claw/
COPY apps/xyne-claw/src           apps/xyne-claw/src
COPY apps/xyne-claw/skills        apps/xyne-claw/skills
COPY apps/xyne-claw/design-skills apps/xyne-claw/design-skills
COPY apps/xyne-claw/understanding-skills apps/xyne-claw/understanding-skills
COPY apps/xyne-claw/scripts       apps/xyne-claw/scripts
# @xyne/storage ships built output (main: dist/index.js); --ignore-scripts
# skipped its prepare hook, so build it explicitly before the typecheck.
RUN pnpm --filter @xyne/litellm-client run build && \
    pnpm --filter @xyne/storage run build && \
    pnpm --filter xyne-claw run typecheck

# Production image
FROM base AS runner
WORKDIR /repo/apps/xyne-claw

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home claw

COPY --from=builder --chown=claw:nodejs /repo /repo

RUN mkdir -p data /repos && chown claw:nodejs data /repos

COPY apps/xyne-claw/infra/kata/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER root

EXPOSE 3002

ENV NODE_ENV=production
ENV MCP_STORE_ROOT=/repo/apps/xyne-claw/data/.mcp-store
ENV XYNE_REPO_WORKSPACE=/repos
ENV GIT_AUTHOR_NAME="Xyne Claw"
ENV GIT_AUTHOR_EMAIL="john.doe@gmail.com"
ENV GIT_COMMITTER_NAME="Xyne Claw"
ENV GIT_COMMITTER_EMAIL="john.doe@gmail.com"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "tsx/esm", "src/main.ts"]

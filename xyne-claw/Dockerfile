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
WORKDIR /app/xyne-claw

# Copy and install shared package dependencies
COPY packages/kata-sdk/package*.json /app/packages/kata-sdk/
RUN cd /app/packages/kata-sdk && npm ci
COPY packages/kata-sdk/ /app/packages/kata-sdk/

COPY xyne-claw-shared/package*.json /app/xyne-claw-shared/
RUN cd /app/xyne-claw-shared && npm ci
COPY xyne-claw-shared/ /app/xyne-claw-shared/

# Copy service files and install
COPY xyne-claw/package*.json ./
RUN npm ci
COPY xyne-claw/tsconfig.json ./
COPY xyne-claw/src ./src
COPY xyne-claw/skills ./skills
COPY xyne-claw/scripts ./scripts
RUN npx tsc --noEmit

# Production image
FROM base AS runner
WORKDIR /app/xyne-claw

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home claw

COPY --from=builder --chown=claw:nodejs /app/xyne-claw ./
COPY --from=builder --chown=claw:nodejs /app/xyne-claw-shared /app/xyne-claw-shared
COPY --from=builder --chown=claw:nodejs /app/packages/kata-sdk /app/packages/kata-sdk

RUN mkdir -p data /repos && chown claw:nodejs data /repos

COPY xyne-claw/infra/kata/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER root

EXPOSE 3002

ENV NODE_ENV=production
ENV MCP_STORE_ROOT=/app/xyne-claw/data/.mcp-store
ENV XYNE_REPO_WORKSPACE=/repos
ENV GIT_AUTHOR_NAME="Xyne Claw"
ENV GIT_AUTHOR_EMAIL="john.doe@gmail.com"
ENV GIT_COMMITTER_NAME="Xyne Claw"
ENV GIT_COMMITTER_EMAIL="john.doe@gmail.com"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "tsx/esm", "src/main.ts"]

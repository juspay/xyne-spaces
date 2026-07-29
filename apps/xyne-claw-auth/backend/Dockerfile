FROM node:22.22.3-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    python3 \
    curl \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /app/xyne-claw-auth/backend

# Copy and install shared package dependencies
COPY packages/kata-sdk/package*.json /app/packages/kata-sdk/
RUN cd /app/packages/kata-sdk && npm ci
COPY packages/kata-sdk/ /app/packages/kata-sdk/

COPY xyne-claw-shared/package*.json /app/xyne-claw-shared/
RUN cd /app/xyne-claw-shared && npm ci
COPY xyne-claw-shared/ /app/xyne-claw-shared/

# Copy service files and install
COPY xyne-claw-auth/backend/package*.json ./
RUN npm ci
COPY xyne-claw-auth/backend/prisma ./prisma
RUN npx prisma generate
COPY xyne-claw-auth/backend/tsconfig.json ./
COPY xyne-claw-auth/backend/src ./src
COPY xyne-claw-auth/backend/scripts ./scripts
RUN npx tsc --noEmit

# Production image
FROM base AS runner
WORKDIR /app/xyne-claw-auth/backend

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home clawauth

COPY --from=builder --chown=clawauth:nodejs /app/xyne-claw-auth/backend ./
COPY --from=builder --chown=clawauth:nodejs /app/xyne-claw-shared /app/xyne-claw-shared
COPY --from=builder --chown=clawauth:nodejs /app/packages/kata-sdk /app/packages/kata-sdk

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

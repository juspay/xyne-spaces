FROM node:22.22.3-slim AS base

# Install build dependencies for native modules and OpenSSL
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    openssl \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
FROM base AS builder
WORKDIR /repo

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json           packages/shared/
COPY packages/storage/package.json          packages/storage/
COPY packages/framework/package.json        packages/framework/
COPY apps/backend/package.json              apps/backend/
COPY apps/backend/eslint-rules/package.json apps/backend/eslint-rules/

# devDependencies are required below for prisma generate and tsc.
# --ignore-scripts: only the manifests are present at this layer, so the
# `prepare` hooks on @xyne/shared and @xyne/icons (which run tsc) would fail
# with no sources or tsconfig.json. The explicit build steps after the source
# COPY below do that work instead.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter xyne-spaces-backend...

# Linux-native canvas binary; optional, tolerated if unavailable for the arch.
RUN pnpm --filter xyne-spaces-backend add -O @napi-rs/canvas-linux-arm64-gnu || true
RUN npm install -g @xyne/xyne-cli@latest || echo "xyne-cli installation failed, continuing..."

COPY packages/shared    packages/shared
COPY packages/storage   packages/storage
COPY packages/framework packages/framework
COPY apps/backend       apps/backend

# backend consumes both from their built dist/
RUN pnpm --filter @xyne/shared --filter @xyne/storage --filter agentic-framework run build

# Cache-busting argument to ensure db:generate always runs
ARG CACHEBUST=1
RUN pnpm --filter xyne-spaces-backend run db:generate
RUN pnpm --filter xyne-spaces-backend run db:common:generate
RUN pnpm --filter xyne-spaces-backend run build

RUN pnpm store prune || true

# ---------------------------------------------------------------------------
# Production image
# ---------------------------------------------------------------------------
FROM node:22.22.3-slim AS runner
WORKDIR /repo/apps/backend

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    jq \
    openssl \
    openssh-client \
    libssl-dev \
    ca-certificates \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Create a non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/backend backend

# The whole workspace is copied, not just apps/backend: under pnpm's isolated
# linker a package's node_modules are symlinks into the root .pnpm store, so
# copying the package alone would leave every dependency dangling.
COPY --from=builder --chown=backend:nodejs /repo /repo

# logger.ts imports the version from the repo-root package.json (../../../package.json)
COPY package.json /package.json

RUN mkdir -p logs && chown backend:nodejs logs && \
    mkdir -p /home/backend/.ssh && \
    chown -R backend:nodejs /home/backend/.ssh && \
    chmod 700 /home/backend/.ssh

# Set bash as default shell for backend user
RUN usermod --shell /bin/bash backend

USER backend

EXPOSE 3001

ENV NODE_ENV=production

# tsx is exec'd directly instead of `pnpm run start`. `pnpm run` does NOT
# forward SIGTERM to the command it spawns: on `kubectl delete pod` pnpm dies
# with `ELIFECYCLE Command failed` and the node child is killed without its
# SIGTERM handler ever running, so the graceful drain in src/index.ts never
# executed and in-flight requests were reset mid-flight (pre-prod 503s on a
# deploy revert, 2026-09-18). Running tsx as PID 1 makes the signal reach the
# process that owns the drain. Same command `pnpm run start` resolved to,
# minus the pnpm hop.
CMD ["./node_modules/.bin/tsx", "dist/index.js"]

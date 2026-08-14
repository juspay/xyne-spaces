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
    python3 \
    python3-pip \
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

# ---------------------------------------------------------------------------
# EnterpriseRAG-Bench dataset (questions + documents JSONL)
# ---------------------------------------------------------------------------
# questions.jsonl is committed to the repo and already in the image via
# the builder COPY. documents.jsonl is too large for git, so we clone from
# HuggingFace and convert the parquet to JSONL at build time — but only if
# the file doesn't already exist (e.g. when present locally or from a
# previous build layer).
RUN apt-get update && apt-get install -y -qq git git-lfs python3 python3-pip > /dev/null 2>&1 && \
    git lfs install && \
    if [ ! -f /repo/apps/backend/src/dataset/documents.jsonl ]; then \
      git clone https://huggingface.co/datasets/onyx-dot-app/EnterpriseRAG-Bench /tmp/rag-bench && \
      pip3 install --no-cache-dir --break-system-packages pandas pyarrow && \
      python3 -c "import pandas as pd; df = pd.read_parquet('/tmp/rag-bench/data/documents/test.parquet'); df.to_json('/repo/apps/backend/src/dataset/documents.jsonl', orient='records', lines=True); print(f'Wrote {len(df)} rows')" && \
      rm -rf /tmp/rag-bench; \
    fi


RUN mkdir -p logs && chown backend:nodejs logs && \
    mkdir -p /home/backend/.ssh && \
    chown -R backend:nodejs /home/backend/.ssh && \
    chmod 700 /home/backend/.ssh

# Set bash as default shell for backend user
RUN usermod --shell /bin/bash backend

USER backend

EXPOSE 3001

ENV NODE_ENV=production

CMD ["pnpm", "run", "start"]

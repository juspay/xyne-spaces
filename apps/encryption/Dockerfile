# syntax=docker/dockerfile:1
FROM node:22.22.3-slim AS base

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    openssl \
    libssl-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

FROM base AS builder
WORKDIR /repo

ARG SOURCE_COMMIT
ARG GITHUB_PAT_TOKEN

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/encryption/package.json apps/encryption/

RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter xyne-spaces-encryption...

COPY packages/shared packages/shared
COPY apps/encryption apps/encryption
ENV DATABASE_URL=postgresql://xyne:xyne123@localhost:5432/xyne_dev_db
RUN pnpm --filter @xyne/shared run build
RUN pnpm --filter xyne-spaces-encryption run build

RUN pnpm store prune || true

FROM node:22.22.3-slim AS runner
WORKDIR /repo/apps/encryption

RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

ENV NODE_ENV=production
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=${SOURCE_COMMIT}

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/encryption encryption

COPY --from=builder --chown=encryption:nodejs /repo /repo

USER encryption

EXPOSE 3012 3013

CMD ["pnpm", "run", "start"]

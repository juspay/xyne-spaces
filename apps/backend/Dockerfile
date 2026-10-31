FROM node:22.23.4-slim AS base

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

# Ream's fonts (scripts/fetch-ream-fonts.mjs: pinned, checksummed) in their own
# stage: its only input is that script, so the layer stays cached and code-only
# builds download nothing. The runner copies it in as a separate layer.
FROM node:22.23.4-slim AS ream-fonts
COPY apps/backend/scripts/fetch-ream-fonts.mjs /fetch-ream-fonts.mjs
RUN node /fetch-ream-fonts.mjs /fonts

FROM base AS builder
WORKDIR /repo

# tsc + prisma generate are heap-heavy on this codebase; without this the `tsc`
# build OOMs (V8 heap, exit 134) under a container's default heap. Builder only.
ENV NODE_OPTIONS="--max-old-space-size=8192"

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm applies these at install time (root package.json → pnpm.patchedDependencies).
COPY patches ./patches
COPY packages/shared/package.json           packages/shared/
COPY packages/storage/package.json          packages/storage/
COPY packages/cache/package.json            packages/cache/
COPY packages/secrets-vault/package.json    packages/secrets-vault/
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

COPY packages/shared        packages/shared
COPY packages/storage       packages/storage
COPY packages/cache         packages/cache
COPY packages/secrets-vault packages/secrets-vault
COPY apps/backend           apps/backend
COPY scripts                scripts

# backend consumes both from their built dist/
RUN pnpm --filter @xyne/shared --filter @xyne/storage --filter @xyne/cache --filter @xyne/secrets-vault run build

# Cache-busting argument to ensure db:generate always runs
ARG CACHEBUST=1
RUN pnpm --filter xyne-spaces-backend run db:generate
RUN pnpm --filter xyne-spaces-backend run db:common:generate
RUN pnpm --filter xyne-spaces-backend run build

# ---------------------------------------------------------------------------
# PROD-SLIM via `pnpm deploy` -> /app
# ---------------------------------------------------------------------------
# This is what removes the dev-tree CVEs. An in-place `pnpm prune/install --prod`
# does NOT work: pnpm's isolated linker leaves dev packages in node_modules/.pnpm,
# so the CVEs (semantic-release -> npm -> tar/pacote/sigstore/brace-expansion/
# http-cache-semantics, plus eslint/prettier/test tooling) and the image size both
# persist. `pnpm deploy` instead builds a FRESH, flat, prod-only node_modules with
# none of that. @prisma/client and tsx are prod deps and are kept.
#
# Two Prisma clients must be re-attached, because deploy reinstalls node_modules
# and skips the gitignored generated output:
#   - main schema   -> default output node_modules/.prisma/client; copied into the
#                      deploy's flat node_modules/.prisma (@prisma/client reads it)
#   - common schema -> custom output prisma-common/generated/client (source tree);
#                      copied back (deploy drops gitignored dirs)
RUN pnpm --filter xyne-spaces-backend --prod --legacy deploy /app && \
    cp -r "$(find node_modules/.pnpm -path '*@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma' -type d | head -1)" /app/node_modules/.prisma && \
    cp -r apps/backend/prisma-common/generated /app/prisma-common/generated

# ---------------------------------------------------------------------------
# Production image
# ---------------------------------------------------------------------------
# Distroless runtime (chat-only hardening). Attack-surface reduction: no shell,
# no package manager, no apt, no coreutils/curl/wget — so an RCE can't spawn
# bash, dump env via `env | grep`, curl the metadata server, or run psql, the
# way the Oct-2026 incident's command-executor did. Also drops libreoffice:
# office-to-PDF conversion (previews and OCR ingestion) runs on Ream, in
# process, with the fonts from the ream-fonts stage in /app/assets/ream-fonts.
# The builder stage above stays a full Node image; only
# this final runtime stage is distroless.
#
# NOTE (debugging): distroless has no shell, so `kubectl exec … -- sh` won't
# work. For a one-off debug session swap this tag to :debug-nonroot (adds a
# busybox shell) and rebuild — never ship :debug to prod.
#
# Includes by default: Node 22 runtime, glibc, libssl3 (Prisma targets
# debian-openssl-3.0.x — see prisma/schema.prisma), CA certs, /tmp, and a
# built-in `nonroot` user (UID 65532). Entrypoint is `node`.
# Patched OpenSSL from Debian bookworm. The distroless base ships libssl3 3.0.18
# (openssl CVEs) and Google hasn't rebuilt it yet; bookworm has 3.0.22-1~deb12u2.
# Same soname (libssl.so.3) + a patch-level bump = ABI-compatible, so Node and
# the Prisma query engine pick up the patched libs. Clears the libssl3 CRITICAL
# + HIGHs. Drop this stage once distroless publishes a patched digest.
FROM debian:12-slim AS libssl
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 && \
    awk 'BEGIN{RS="";ORS="\n\n"} /^Package: libssl3\n/{print}' /var/lib/dpkg/status > /libssl3.status && \
    rm -rf /var/lib/apt/lists/*

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runner
WORKDIR /app

# Overlay the patched OpenSSL shared libs onto the distroless base.
COPY --from=libssl /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3
COPY --from=libssl /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3
# Update the dpkg metadata the scanners read so it reflects the patched version
# (the base's status.d still says 3.0.18; the binaries above are now 3.0.22).
COPY --from=libssl /libssl3.status /var/lib/dpkg/status.d/libssl3

# The prod-slim `pnpm deploy` tree from the builder: a flat, prod-only
# node_modules + dist + both Prisma clients — no dev tree, no .pnpm store.
# Owned by the distroless nonroot uid/gid (65532) so the process owns what it reads.
COPY --from=builder --chown=65532:65532 /app /app

# Ream's fonts as their own layer: unchanged between releases, so registries and
# nodes reuse it rather than pushing and pulling it with every code change.
COPY --from=ream-fonts --chown=65532:65532 /fonts /app/assets/ream-fonts

# logger.ts reads the version from the repo-root package.json; with the app root
# at /app, its ../../../package.json resolves to /package.json.
COPY --chown=65532:65532 package.json /package.json

USER nonroot

EXPOSE 3001

ENV NODE_ENV=production

# Entrypoint is `node`, so this becomes: node --import tsx dist/index.js.
# `tsc && tsc-alias --resolve-full-paths` makes OUR code plain-node-ready, but a
# few deps (e.g. @juspay-jaf/jaf) ship ESM with extensionless imports that bare
# node ESM rejects; tsx is kept purely as the loader that resolves them. tsx is
# a runtime dependency so it survives the --prod prune above; the heavy dev tree
# (semantic-release/npm, eslint, test tooling) does not — that's the CVE win.
CMD ["--import", "tsx", "dist/index.js"]

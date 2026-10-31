FROM node:22.23.4-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /repo

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm applies these at install time (root package.json → pnpm.patchedDependencies).
COPY patches ./patches
COPY packages/shared/package.json           packages/shared/
COPY packages/icons/package.json            packages/icons/
COPY apps/dashboard/package.json            apps/dashboard/
COPY apps/backend/package.json              apps/backend/
COPY apps/backend/eslint-rules/package.json apps/backend/eslint-rules/

# dashboard + its workspace deps; backend is included for the Prisma client the
# dashboard imports (@prisma/client, generated from backend's schema below).
# --ignore-scripts: only the manifests are present at this layer, so the
# `prepare` hooks on @xyne/shared and @xyne/icons (which run tsc) would fail
# with no sources or tsconfig.json. The explicit build steps after the source
# COPY below do that work instead.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts \
      --filter xyne-spaces-dashboard... --filter xyne-spaces-backend

COPY packages/shared packages/shared
COPY packages/icons  packages/icons

# dashboard consumes both from their built dist/
RUN pnpm --filter @xyne/shared --filter @xyne/icons run build

# Prisma client (schema only — cheap layer, changes rarely)
COPY apps/backend/prisma apps/backend/prisma
RUN pnpm --filter xyne-spaces-backend exec prisma generate

# Copy source code LAST to maximize caching
COPY apps/dashboard apps/dashboard

# logger.ts imports the version from the repo-root package.json (../../../package.json)
COPY package.json /package.json

ENV NODE_OPTIONS="--max-old-space-size=8192"

# NOTE: `validate:raw` (typecheck + prettier format:check + eslint) is intentionally
# NOT run here. Linting/formatting are CI quality gates, not requirements to produce
# the deployable bundle, and running eslint inside the (emulated) image build is very
# slow. Type safety is still enforced — the `build` script below is `tsc --noEmit &&
# vite build`, so a type error still fails the image. Run lint/format in CI (or the
# Jenkins validation stage) against the source, not in the image build.
# RUN pnpm --filter xyne-spaces-dashboard run validate:raw

# Accept build argument for source commit
ARG SOURCE_COMMIT
ENV REACT_APP_SOURCE_COMMIT=$SOURCE_COMMIT

# Accept build argument for API URL
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

ARG VITE_INTERNAL_XYNE_HOSTS=
ENV VITE_INTERNAL_XYNE_HOSTS=${VITE_INTERNAL_XYNE_HOSTS}
ARG VITE_TRUSTED_ORIGINS=
ENV VITE_TRUSTED_ORIGINS=${VITE_TRUSTED_ORIGINS}
ARG VITE_APPS_PUBLIC_BASE_URL=
ENV VITE_APPS_PUBLIC_BASE_URL=${VITE_APPS_PUBLIC_BASE_URL}
ARG VITE_LEGAL_CONTACT_EMAIL=
ENV VITE_LEGAL_CONTACT_EMAIL=${VITE_LEGAL_CONTACT_EMAIL}
ARG VITE_PRIVACY_CONTACT_EMAIL=
ENV VITE_PRIVACY_CONTACT_EMAIL=${VITE_PRIVACY_CONTACT_EMAIL}

# VITE_ZERO_SERVER is deliberately NOT set here. config.ts reads it when present,
# and baking an absolute URL made it win over the serving host — a bundle on
# app.example.org opened wss://example.org/zero. Unset, the
# URL derives from whatever host serves the bundle. Local dev, sandbox and the
# test compose file still set it themselves via their own .env files.

# Mixpanel token (public client-side analytics; injected at build time)
ARG VITE_MIXPANEL_TOKEN=""
ENV VITE_MIXPANEL_TOKEN=${VITE_MIXPANEL_TOKEN}

# PostHog key (public client-side analytics; injected at build time)
ARG VITE_POSTHOG_KEY=""
ENV VITE_POSTHOG_KEY=${VITE_POSTHOG_KEY}
ARG VITE_POSTHOG_HOST=""
ENV VITE_POSTHOG_HOST=${VITE_POSTHOG_HOST}

# Default workspace ID
ENV VITE_DEFAULT_WORKSPACE_ID=6642623f-cca7-43ad-9a6b-5e49c33226b4

# Slack app install URL shown on the self-serve migration page (public; baked into the bundle at build time)
ARG VITE_SLACK_APP_INSTALL_URL="https://api.slack.com/apps/A09QL5AE5PY/install-on-team"
ENV VITE_SLACK_APP_INSTALL_URL=${VITE_SLACK_APP_INSTALL_URL}

# Build the Vite React app with increased memory
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN pnpm --filter xyne-spaces-dashboard run build

# Create ZIP of the built assets for Electron OTA updates
# The ZIP will be served at /releases/dashboard.zip
RUN apt-get update && apt-get install -y zip && \
    mkdir -p /repo/apps/dashboard/releases && \
    cd /repo/apps/dashboard/dist && zip -r ../releases/dashboard.zip .


FROM scratch AS bundle
COPY --from=builder /repo/apps/dashboard/dist /
COPY --from=builder /repo/apps/dashboard/releases /releases

# ---------------------------------------------------------------------------
# Production image — hardened, non-root nginx.
#
# Hardening vs the old `nginx:alpine` stage:
#   - Base is nginxinc/nginx-unprivileged: the master process runs as the nginx
#     user (uid 101) by default — no root, no manual user creation.
#   - nodejs + npm REMOVED. 
#   - Base pinned to a minor tag for reproducibility.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

# The pinned base can ship outdated Alpine packages (libssl3/libcrypto3/curl/
# libexpat/libpng/libxml2/zlib/…), which is the ENTIRE CVE surface of this image
# (no node_modules in the runtime). Upgrade them to the latest patched versions
# to clear those base CVEs. apk needs root; the base runs as uid 101, so switch
# up for the upgrade and back down.
USER root
RUN apk upgrade --no-cache
USER 101

# Static assets + Electron OTA releases. Read-only — the uid-101 worker only
# needs read access, which the default root-owned, world-readable copy provides.
COPY --from=builder /repo/apps/dashboard/dist /usr/share/nginx/html
COPY --from=builder /repo/apps/dashboard/releases /usr/share/nginx/html/releases

# nginx.conf as a template; ONLY ${ENABLE_MIGRATION} is substituted at startup
# (nginx's own $variables are left untouched by the explicit envsubst arg).
COPY apps/dashboard/nginx.conf /etc/nginx/nginx.conf.template

# Migration feature flag (nginx.conf proxies /migration/ only when true).
ENV ENABLE_MIGRATION=false

EXPOSE 8080

# uid 101 can't write /etc/nginx, so render the config into /tmp (writable) and
# run from there. ENTRYPOINT cleared so only this renders+runs (we do envsubst
# ourselves rather than via the base image's template entrypoint).
ENTRYPOINT []
CMD ["/bin/sh", "-c", "envsubst '${ENABLE_MIGRATION}' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf && exec nginx -c /tmp/nginx.conf -g 'daemon off;'"]

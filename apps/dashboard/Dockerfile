FROM node:22.22.3-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /repo

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
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

# Run validation (TypeScript + ESLint)
# validate:raw, not validate: the image has no scripts/ directory, and an image
# build has no use for the interactive agent handoff the wrapper adds.
RUN pnpm --filter xyne-spaces-dashboard run validate:raw

# Accept build argument for source commit
ARG SOURCE_COMMIT
ENV REACT_APP_SOURCE_COMMIT=$SOURCE_COMMIT

# Accept build argument for API URL
ENV VITE_API_URL=https://spaces.xyne.juspay.net/api

# --- Deployment lane -------------------------------------------------------
# Defaults build the main bundle. The SDLC image adds:
#   --build-arg BUILD_SCRIPT=build:sdlc --build-arg STATIC_SUBDIR=sdlc-app
# Everything else comes from .env.sdlc via `vite build --mode sdlc`, including
# VITE_ZERO_PATH.
#
# VITE_ZERO_SERVER is deliberately NOT set here. config.ts reads it when present,
# and baking an absolute URL made it win over the serving host — a bundle on
# app.spaces.xyne.juspay.net opened wss://spaces.xyne.juspay.net/zero. Unset, the
# URL derives from whatever host serves the bundle. Local dev, sandbox and the
# test compose file still set it themselves via their own .env files.
ARG BUILD_SCRIPT=build

# Only read by the main bundle; defaults to /sdlc-app in config.ts.
ARG SDLC_APP_BASE_PATH=""
ENV VITE_SDLC_APP_BASE_PATH=${SDLC_APP_BASE_PATH}

# Subdirectory the assets are stored under, matching the base path they were
# built with, so the edge needs no rewriting. Empty for the main bundle.
ARG STATIC_SUBDIR=""

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

# Build the Vite React app with increased memory
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN pnpm --filter xyne-spaces-dashboard run ${BUILD_SCRIPT}

# Create ZIP of the built assets for Electron OTA updates
# The ZIP will be served at /releases/dashboard.zip
RUN apt-get update && apt-get install -y zip && \
    mkdir -p /repo/apps/dashboard/releases && \
    cd /repo/apps/dashboard/dist && zip -r ../releases/dashboard.zip .

# Production image with nginx
FROM nginx:alpine AS runner

# Install Node.js and npm for running node commands in pod
RUN apk add --no-cache nodejs npm

# Create a non-root user
RUN addgroup --system --gid 1001 frontend && \
    adduser --system --uid 1001 frontend

# Copy nginx configuration as template for envsubst
COPY --chown=frontend:frontend apps/dashboard/nginx.conf /etc/nginx/nginx.conf.template

# Re-declare in the runner stage: ARGs do not cross stage boundaries.
ARG STATIC_SUBDIR=""

# Only the built assets cross into the runner, so the builder's workspace layout
# does not matter here — no node_modules or symlinks are carried over.
COPY --from=builder --chown=frontend:frontend /repo/apps/dashboard/dist /usr/share/nginx/html/${STATIC_SUBDIR}

# Copy releases folder with dashboard.zip for Electron OTA updates
COPY --from=builder --chown=frontend:frontend /repo/apps/dashboard/releases /usr/share/nginx/html/releases

# Set default value for migration flag
ENV ENABLE_MIGRATION=false

# Change ownership of nginx directories (fast)
RUN chown -R frontend:frontend /var/cache/nginx && \
    chown -R frontend:frontend /var/log/nginx && \
    chown -R frontend:frontend /etc/nginx/conf.d && \
    touch /etc/nginx/nginx.conf && \
    chown frontend:frontend /etc/nginx/nginx.conf && \
    touch /var/run/nginx.pid && \
    chown frontend:frontend /var/run/nginx.pid

USER frontend

EXPOSE 8080

# Use envsubst to replace environment variables at runtime
CMD ["/bin/sh", "-c", "envsubst '${ENABLE_MIGRATION}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]

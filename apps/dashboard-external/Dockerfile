# Multi-stage build for dashboard-external.
# Serves the public call-join flow (ExternalLobbyPage) without mTLS.
# Imports dashboard/src via Vite alias — no component copies required.

# Stage 1: Build dashboard-external inside the workspace.
# The separate shared-builder stage is gone: one workspace install resolves
# @xyne/shared through its workspace:* link.
FROM node:22.22.3-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /repo

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json            packages/shared/
COPY packages/icons/package.json             packages/icons/
COPY apps/dashboard/package.json             apps/dashboard/
COPY apps/dashboard-external/package.json    apps/dashboard-external/

# dashboard is installed alongside so the resolveFromDashboardExternal Vite
# plugin can fall back to its dependency tree for bare imports from dashboard/src.
# --ignore-scripts: only the manifests are present at this layer, so the
# `prepare` hooks on @xyne/shared and @xyne/icons (which run tsc) would fail
# with no sources or tsconfig.json. The explicit build steps after the source
# COPY below do that work instead.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts \
      --filter xyne-spaces-dashboard-external... --filter xyne-spaces-dashboard...

COPY packages/shared packages/shared
RUN pnpm --filter @xyne/shared run build

# dashboard/src imports @xyne/icons (workspace dep of dashboard), consumed from dist/
COPY packages/icons packages/icons
RUN pnpm --filter @xyne/icons run build

# dashboard/src is aliased as @/ in vite.config.ts
COPY apps/dashboard/src apps/dashboard/src

# Copy remaining source LAST to maximise layer caching
COPY apps/dashboard-external apps/dashboard-external

# Root package.json (some transitive deps resolve ../../../package.json)
COPY package.json /package.json

ARG SOURCE_COMMIT
ENV REACT_APP_SOURCE_COMMIT=$SOURCE_COMMIT

# Target domain — overridable at build time with --build-arg
ARG API_BASE_URL=https://spaces.xyne.juspay.net/api
ARG CALL_INVITE_BASE_URL=https://call.xyne.juspay.net/external
ARG INTERNAL_DASHBOARD_BASE_URL=https://spaces.xyne.juspay.net
ENV VITE_API_BASE_URL=$API_BASE_URL
ENV VITE_CALL_INVITE_BASE_URL=$CALL_INVITE_BASE_URL
ENV VITE_INTERNAL_DASHBOARD_BASE_URL=$INTERNAL_DASHBOARD_BASE_URL

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm --filter xyne-spaces-dashboard-external run build

# Stage 3: nginx — deployed without Istio mTLS for public access
FROM nginx:alpine AS runner

RUN addgroup --system --gid 1001 frontend && \
    adduser --system --uid 1001 frontend

# Minimal SPA-only nginx config (no bundle-branch proxy, no migration service)
COPY --chown=frontend:frontend apps/dashboard-external/nginx.conf /etc/nginx/nginx.conf

COPY --from=builder --chown=frontend:frontend /repo/apps/dashboard-external/dist /usr/share/nginx/html/external
COPY --chown=frontend:frontend apps/dashboard/public/sounds /usr/share/nginx/html/external/sounds
COPY --chown=frontend:frontend apps/dashboard/public/images /usr/share/nginx/html/external/images

RUN chown -R frontend:frontend /var/cache/nginx && \
    chown -R frontend:frontend /var/log/nginx && \
    chown -R frontend:frontend /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown frontend:frontend /var/run/nginx.pid

USER frontend

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

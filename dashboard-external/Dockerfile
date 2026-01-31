# Multi-stage build for dashboard-external.
# Serves the public call-join flow (ExternalLobbyPage) without mTLS.
# Imports dashboard/src via Vite alias — no component copies required.

# Stage 1: Build shared module
FROM node:22.22.3-slim AS shared-builder
WORKDIR /shared
COPY shared/package*.json ./
RUN npm ci --ignore-scripts
COPY shared/ .
RUN npm run build

# Stage 2: Build dashboard-external
FROM node:22.22.3-slim AS builder
WORKDIR /app

# Reuse shared module build output
COPY --from=shared-builder /shared ../shared

# Install dashboard node_modules so the resolveFromDashboardExternal Vite plugin
# can fall back to dashboard's dependency tree for bare module imports from dashboard/src.
COPY dashboard/package*.json ../dashboard/
RUN cd ../dashboard && npm ci --ignore-scripts

# dashboard/src is aliased as @/ in vite.config.ts
COPY dashboard/src ../dashboard/src

# Install dashboard-external dependencies
COPY dashboard-external/package*.json ./
RUN npm i --ignore-scripts

# Copy remaining source LAST to maximise layer caching
COPY dashboard-external/ .

# Root package.json (some transitive deps resolve ../../../package.json)
COPY package.json /package.json

ARG SOURCE_COMMIT
ENV REACT_APP_SOURCE_COMMIT=$SOURCE_COMMIT

# Target domain — overridable at build time with --build-arg
ARG API_BASE_URL=https://spaces.xyne.juspay.net/api
ARG CALL_INVITE_BASE_URL=https://call.xyne.juspay.net/external
ENV VITE_API_BASE_URL=$API_BASE_URL
ENV VITE_CALL_INVITE_BASE_URL=$CALL_INVITE_BASE_URL

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# Stage 3: nginx — deployed without Istio mTLS for public access
FROM nginx:alpine AS runner

RUN addgroup --system --gid 1001 frontend && \
    adduser --system --uid 1001 frontend

# Minimal SPA-only nginx config (no bundle-branch proxy, no migration service)
COPY --chown=frontend:frontend dashboard-external/nginx.conf /etc/nginx/nginx.conf

COPY --from=builder --chown=frontend:frontend /app/dist /usr/share/nginx/html/external
COPY --chown=frontend:frontend dashboard/public/sounds /usr/share/nginx/html/external/sounds
COPY --chown=frontend:frontend dashboard/public/images /usr/share/nginx/html/external/images

RUN chown -R frontend:frontend /var/cache/nginx && \
    chown -R frontend:frontend /var/log/nginx && \
    chown -R frontend:frontend /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown frontend:frontend /var/run/nginx.pid

USER frontend

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

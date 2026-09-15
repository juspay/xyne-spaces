# Dashboard edge: nginx disk cache in front of a loopback Node app that
# resolves rules and fetches bundles from object storage. Build context is
# the repo root (pnpm workspace): docker build -f apps/dashboard-edge/Dockerfile .

# --- app build ---------------------------------------------------------------
FROM node:22.22.3-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /repo

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/storage/package.json      packages/storage/
COPY apps/dashboard-edge/package.json   apps/dashboard-edge/

# --ignore-scripts: only manifests exist at this layer; @xyne/storage's
# prepare hook (tsc) runs explicitly after its sources are copied.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter xyne-spaces-dashboard-edge...

COPY packages/storage packages/storage
RUN pnpm --filter @xyne/storage run build

COPY apps/dashboard-edge/tsconfig.json apps/dashboard-edge/
COPY apps/dashboard-edge/src           apps/dashboard-edge/src
RUN pnpm --filter xyne-spaces-dashboard-edge run build

# Self-contained production tree: dist + production node_modules only.
RUN pnpm --filter xyne-spaces-dashboard-edge deploy --legacy --prod /out/app

# --- runtime -----------------------------------------------------------------
FROM nginx:1.27-alpine AS runner
RUN apk add --no-cache nodejs gettext ca-certificates curl tini \
 && addgroup -S -g 1001 edge && adduser -S -u 1001 -G edge edge \
 && mkdir -p /var/cache/edge /var/run/edge /etc/edge/rules \
 && chown -R edge:edge /var/cache/edge /var/run/edge /etc/edge

COPY --from=builder --chown=edge:edge /out/app /opt/edge/app
COPY --chown=edge:edge apps/dashboard-edge/nginx/nginx.conf        /opt/edge/nginx.conf.template
COPY --chown=edge:edge apps/dashboard-edge/nginx/proxy-origin.conf /opt/edge/proxy-origin.conf.template
COPY --chown=edge:edge apps/dashboard-edge/docker-entrypoint.sh    /opt/edge/docker-entrypoint.sh
RUN chmod +x /opt/edge/docker-entrypoint.sh

USER edge
EXPOSE 8080
ENV NODE_ENV=production
ENTRYPOINT ["/sbin/tini", "--", "/opt/edge/docker-entrypoint.sh"]

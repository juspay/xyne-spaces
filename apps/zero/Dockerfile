# zero-cache runtime image (Rocicorp Zero) fronted by nginx on :8080.
#
# Layout mirrors the image currently running in production
# (asia.gcr.io/xyne-spaces/xyne-spaces-zero):
#   /opt/app        pnpm project whose only dependency is @rocicorp/zero
#   /etc/nginx      nginx.conf proxying :8080 -> zero-cache on :4848
#   /start-zero.sh  entrypoint: zero-cache in background, nginx in foreground
#
# Bumping the Zero version:
#   edit ZERO_VERSION below (or pass --build-arg ZERO_VERSION=x.y.z), then
#   `make push-zero`. The version is baked into the image, so a new version
#   always produces a new image tag.

ARG NODE_VERSION=22.22.3

ARG LITESTREAM_SRC_IMAGE=asia.gcr.io/xyne-spaces/xyne-spaces-zero:2513008c3b-v18
FROM ${LITESTREAM_SRC_IMAGE} AS litestream

FROM node:${NODE_VERSION}-alpine

# Version of @rocicorp/zero to install. Override at build time:
#   docker buildx build --build-arg ZERO_VERSION=1.8.0 ...
ARG ZERO_VERSION=1.9.0

# Optional: install from a vendored tarball instead of the npm registry.
# Place the .tgz next to this Dockerfile and build with
#   --build-arg ZERO_TARBALL=rocicorp-zero-1.9.0.tgz
# This is how the current production image was built.
ARG ZERO_TARBALL=""

ENV NODE_ENV=production \
    PATH="/opt/app/node_modules/.bin:${PATH}" \
    ZERO_LITESTREAM_EXECUTABLE=/usr/local/bin/litestream \
    ZERO_LITESTREAM_EXECUTABLE_V5=/usr/local/bin/litestream-v5

# nginx serves :8080 and proxies to zero-cache; su-exec/tini are not used because
# start-zero.sh keeps nginx as PID 1, matching the production image.
RUN apk add --no-cache nginx curl \
    && corepack enable \
    && mkdir -p /opt/app /run/nginx

WORKDIR /opt/app

# pnpm needs the workspace file for the native-build allowlist
# (@rocicorp/zero-sqlite3 compiles at install time).
COPY apps/zero/package.json apps/zero/pnpm-workspace.yaml ./

# Copy the tarball only when one is supplied. The wildcard keeps the COPY valid
# when no .tgz exists in the build context.
COPY apps/zero/*.tgz* ./

RUN set -eux; \
    if [ -n "$ZERO_TARBALL" ]; then \
        echo "Installing @rocicorp/zero from tarball: $ZERO_TARBALL"; \
        npm pkg set "dependencies.@rocicorp/zero=file:$ZERO_TARBALL"; \
    else \
        echo "Installing @rocicorp/zero@$ZERO_VERSION from registry"; \
        npm pkg set "dependencies.@rocicorp/zero=$ZERO_VERSION"; \
    fi; \
    pnpm install --prod --no-frozen-lockfile; \
    pnpm store prune || true; \
    rm -f /opt/app/*.tgz; \
    node -e "console.log('installed @rocicorp/zero', require('/opt/app/node_modules/@rocicorp/zero/package.json').version)"

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=litestream /usr/local/bin/litestream-v5 /usr/local/bin/litestream-v5

# nginx config: :8080 -> 127.0.0.1:4848, WebSocket upgrade, buffering disabled
COPY apps/zero/nginx.conf /etc/nginx/nginx.conf

COPY apps/zero/start-zero.sh /start-zero.sh
RUN chmod +x /start-zero.sh

# 8080 = nginx (Service target), 4848 = zero-cache (probe target: only node owns
# this port, so a probe against it actually detects zero-cache death)
EXPOSE 8080 4848

LABEL org.opencontainers.image.title="xyne-spaces-zero" \
      org.opencontainers.image.description="Rocicorp zero-cache behind nginx" \
      com.xyne.zero.version="${ZERO_VERSION}"

ENTRYPOINT ["/start-zero.sh"]

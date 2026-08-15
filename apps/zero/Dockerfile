ARG NODE_VERSION=22.23.1

FROM golang:1.25.10 AS litestream

WORKDIR /src/
RUN git clone --depth 1 --branch zero@v0.0.9 https://github.com/rocicorp/litestream.git
WORKDIR /src/litestream/

ARG LITESTREAM_VERSION=0.3.13+z0.0.9

ENV GOTOOLCHAIN=local

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg \
    go build -ldflags "-s -w -X 'main.Version=${LITESTREAM_VERSION}' -extldflags '-static'" \
      -tags osusergo,netgo,sqlite_omit_load_extension -o /usr/local/bin/litestream ./cmd/litestream

FROM litestream/litestream:0.5.16 AS litestream-v5

FROM node:${NODE_VERSION}-alpine

ARG ZERO_VERSION=1.9.0
ARG ZERO_TARBALL=""

RUN apk add --no-cache curl readline readline-dev nginx \
    && corepack enable && corepack prepare pnpm@11.11.0 --activate \
    && mkdir -p /opt/app /run/nginx

WORKDIR /opt/app

COPY apps/zero/package.json apps/zero/pnpm-workspace.yaml ./
COPY apps/zero/*.tgz* ./

RUN set -eux; \
    if [ -n "$ZERO_TARBALL" ]; then \
        pnpm add "./$ZERO_TARBALL"; \
    else \
        pnpm add "@rocicorp/zero@$ZERO_VERSION"; \
    fi; \
    pnpm store prune || true; \
    rm -f /opt/app/*.tgz; \
    node -e "console.log('installed @rocicorp/zero', require('/opt/app/node_modules/@rocicorp/zero/package.json').version)"

ENV PATH="/opt/app/node_modules/.bin:${PATH}"

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=litestream-v5 /usr/local/bin/litestream /usr/local/bin/litestream-v5
COPY --from=litestream-v5 /usr/local/lib/litestream-vfs.so /usr/local/lib/litestream-vfs.so

RUN cp /opt/app/node_modules/@rocicorp/zero/out/zero-cache/src/services/litestream/config.yml /etc/litestream.yml

ENV ZERO_LITESTREAM_EXECUTABLE=/usr/local/bin/litestream
ENV ZERO_LITESTREAM_EXECUTABLE_V5=/usr/local/bin/litestream-v5
ENV ZERO_LITESTREAM_VFS_EXTENSION_PATH=/usr/local/lib/litestream-vfs.so
ENV ZERO_LITESTREAM_CONFIG_PATH=/etc/litestream.yml
ENV ZERO_LOG_FORMAT=json
ENV ZERO_SERVER_VERSION=${ZERO_VERSION}
ENV ZERO_IN_CONTAINER=1

COPY apps/zero/nginx.conf /etc/nginx/nginx.conf

COPY apps/zero/start-zero.sh /start-zero.sh
RUN chmod +x /start-zero.sh

EXPOSE 8080 4848 4849

ENTRYPOINT ["/start-zero.sh"]

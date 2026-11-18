# Dashboard edge: nginx disk cache in front of a loopback Node app that
# resolves rules and fetches bundles from object storage, on distroless Node
# (no shell, package manager or coreutils). src/launcher.ts is PID 1: it
# renders the nginx config, runs the app and nginx and forwards signals.
# nginx is nginx.org's Debian 13 package, copied in with the two libraries
# distroless lacks (pcre2, libcrypt) and their dpkg entries so scanners see
# them. Runs as `edge` (uid 1001). Build context is the repo root:
#   docker build -f apps/dashboard-edge/Dockerfile .

# --- app build ---------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22.23.4-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /repo

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/storage/package.json packages/storage/

# --ignore-scripts: only manifests exist at this layer; @xyne/storage's
# prepare hook (tsc) runs explicitly after its sources are copied.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter @xyne/storage
COPY packages/storage packages/storage
RUN pnpm --filter @xyne/storage run build

WORKDIR /repo/apps/dashboard-edge
COPY apps/dashboard-edge/package.json apps/dashboard-edge/pnpm-lock.yaml apps/dashboard-edge/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts
COPY apps/dashboard-edge/tsconfig.json ./
COPY apps/dashboard-edge/src ./src
RUN pnpm run build

# Self-contained production tree: dist + production node_modules only.
RUN pnpm prune --prod \
 && mkdir -p /out/app && cp -a package.json dist node_modules /out/app/

FROM --platform=$BUILDPLATFORM alpine:3.21 AS cabundle
RUN apk upgrade --no-cache ca-certificates-bundle \
 && v="$(apk list -I ca-certificates-bundle | awk '{print $1}' | sed 's/^ca-certificates-bundle-//')" \
 && { [ "$(apk version -t "$v" 20261020-r0)" != "<" ] \
      || { echo "ca-certificates-bundle ${v:-missing} is older than 20261020-r0" >&2; exit 1; }; }

# --- nginx -------------------------------------------------------------------
FROM nginx:1.30.7-trixie AS nginx

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:39c66687298417dbf3ff2fb8b6012c20554494e16414ef7afd07b9abbb45b501 AS distroless
FROM debian:trixie-slim AS rootfs
COPY --from=nginx /usr/sbin/nginx /usr/sbin/nginx
COPY --from=nginx /var/lib/dpkg/status /nginx-dpkg/status
COPY --from=distroless /etc/passwd /etc/group /out/etc/
# Shared libraries distroless does not ship, dpkg entries for everything
# copied (so image scanners can see it), the edge user, and the writable dirs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpcre2-8-0 libcrypt1 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /out/var/lib/dpkg/status.d \
 && for pkg in libcrypt1:libcrypt.so.1 libpcre2-8-0:libpcre2-8.so.0; do \
      so="${pkg#*:}"; pkg="${pkg%%:*}"; \
      p="$(ldd /usr/sbin/nginx | awk -v so="$so" '$1 == so { print $3 }')"; \
      [ -n "$p" ] || { echo "nginx does not link $so" >&2; exit 1; }; \
      d="/out$(dirname "$(readlink -f "$p")")"; mkdir -p "$d"; cp -L "$p" "$d/$so"; \
      dpkg-query -s "$pkg" > "/out/var/lib/dpkg/status.d/$pkg"; \
    done \
 && dpkg-query --admindir=/nginx-dpkg -s nginx > /out/var/lib/dpkg/status.d/nginx \
 && echo 'edge:x:1001:1001:edge:/nonexistent:/sbin/nologin' >> /out/etc/passwd \
 && echo 'edge:x:1001:' >> /out/etc/group \
 && mkdir -p /dirs/cache /dirs/run /dirs/rules

# --- runtime -----------------------------------------------------------------
FROM distroless AS runner
COPY --from=cabundle /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=rootfs /out/etc/passwd /out/etc/group /etc/
COPY --from=rootfs /out/usr/lib/ /usr/lib/
COPY --from=rootfs /out/var/lib/dpkg/status.d/ /var/lib/dpkg/status.d/
COPY --from=nginx /usr/sbin/nginx /usr/sbin/nginx
COPY --from=rootfs --chown=1001:1001 /dirs/cache /var/cache/edge
COPY --from=rootfs --chown=1001:1001 /dirs/run /var/run/edge
COPY --from=rootfs --chown=1001:1001 /dirs/rules /etc/edge/rules

# Root-owned: the edge user can read but not change its own code or templates.
COPY --from=builder --chown=0:0 /out/app /opt/edge/app
COPY --chown=0:0 apps/dashboard-edge/nginx/nginx.conf        /opt/edge/nginx.conf.template
COPY --chown=0:0 apps/dashboard-edge/nginx/proxy-origin.conf /opt/edge/proxy-origin.conf.template

# Fails the build if nginx cannot load its libraries.
RUN ["/usr/sbin/nginx", "-V"]

USER 1001:1001
EXPOSE 8080
ENV NODE_ENV=production
ENTRYPOINT ["/nodejs/bin/node", "/opt/edge/app/dist/launcher.js"]

# Dashboard edge: nginx disk cache in front of a loopback Node app that
# resolves rules and fetches bundles from object storage, on distroless Node
# (no shell, package manager or coreutils). src/launcher.ts is PID 1: it
# renders the nginx config, runs the app and nginx and forwards signals.
# nginx is nginx.org's Debian 13 package, copied in with the two libraries
# distroless lacks (pcre2, libcrypt) and their dpkg entries so scanners see
# them. Runs as `edge` (uid 1001). Build context is the repo root:
#   docker build -f apps/dashboard-edge/Dockerfile .
#
# The bases can be swapped for a mirror without editing this file:
#   --build-arg BUILD_IMAGE=... --build-arg NGINX_BASE_IMAGE=... --build-arg RUNTIME_IMAGE=...

# node:22.23.4-trixie-slim, debian:13-slim and distroless nodejs22-debian13:nonroot (multi-arch indexes).
ARG BUILD_IMAGE=docker.io/library/node:22.23.4-trixie-slim@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f
ARG NGINX_BASE_IMAGE=docker.io/library/debian:13-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:8ad9cc935b7843c4024b7e1487b5ef472c354ea847b97c667023e2618552607e

# --- app build ---------------------------------------------------------------
FROM ${BUILD_IMAGE} AS builder
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /repo

# Manifests + lockfile first so the install layer caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/storage/package.json      packages/storage/
COPY apps/dashboard-edge/package.json   apps/dashboard-edge/

# Drop the root workspace package's deps (release tooling, @juspay/yama and its
# ML stack), which the filter would otherwise install and `pnpm deploy` would
# ship; the lockfile stays frozen for everything else.
RUN awk 'BEGIN{skip=0} /^importers:/{imp=1} imp&&/^  \.:/{print "  .: {}"; skip=1; next} skip&&/^  [^ ]/{skip=0} skip&&/^[^ ]/{skip=0} !skip{print}' pnpm-lock.yaml > /tmp/lock \
 && mv /tmp/lock pnpm-lock.yaml \
 && node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('package.json'));delete j.dependencies;delete j.devDependencies;delete j.optionalDependencies;delete j.scripts;fs.writeFileSync('package.json',JSON.stringify(j,null,2))"

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

# --- nginx -------------------------------------------------------------------
# Debian 13 with current security updates, nginx from nginx.org's repo pinned
# to one version. Collects what the runtime needs under /out.
FROM ${NGINX_BASE_IMAGE} AS nginx
ARG NGINX_VERSION=1.31.8-1~trixie
RUN apt-get update \
 && apt-get -y upgrade \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/mainline/debian/ trixie nginx" > /etc/apt/sources.list.d/nginx.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "nginx=${NGINX_VERSION}" \
 && rm -rf /var/lib/apt/lists/*
# Shared libraries distroless does not ship, dpkg entries for everything
# copied (so image scanners can see it), the edge user, and the writable dirs.
RUN set -eu \
 && mkdir -p /out/etc /out/var/lib/dpkg/status.d /dirs/cache /dirs/run /dirs/rules \
 && for p in libpcre2-8-0 libcrypt1; do dpkg -L "$p" | grep '\.so' | xargs -I{} cp --parents -a {} /out; done \
 && for p in nginx libpcre2-8-0 libcrypt1 ca-certificates; do dpkg -s "$p" > "/out/var/lib/dpkg/status.d/$p"; done \
 && printf 'root:x:0:0:root:/root:/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/sbin/nologin\nnonroot:x:65532:65532:nonroot:/home/nonroot:/sbin/nologin\nedge:x:1001:1001:edge:/nonexistent:/sbin/nologin\n' > /out/etc/passwd \
 && printf 'root:x:0:\nnobody:x:65534:\nnonroot:x:65532:\nedge:x:1001:\n' > /out/etc/group

# --- runtime -----------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runner
COPY --from=nginx /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=nginx /out/etc/passwd /out/etc/group /etc/
COPY --from=nginx /out/usr/lib/ /usr/lib/
COPY --from=nginx /out/var/lib/dpkg/status.d/ /var/lib/dpkg/status.d/
COPY --from=nginx /usr/sbin/nginx /usr/sbin/nginx
COPY --from=nginx --chown=1001:1001 /dirs/cache /var/cache/edge
COPY --from=nginx --chown=1001:1001 /dirs/run   /var/run/edge
COPY --from=nginx --chown=1001:1001 /dirs/rules /etc/edge/rules

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

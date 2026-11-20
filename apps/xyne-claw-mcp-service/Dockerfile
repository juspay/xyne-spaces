# xyne-claw-mcp-service image. Build context: repo root.
#   docker build -f apps/xyne-claw-mcp-service/Dockerfile .

# Build stage: workspace dependencies, npm MCP servers, Python MCP servers.
# Same Node version as the runtime image below.
FROM node:22.23.5-trixie-slim AS builder
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages uv==0.13.6
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/kata-sdk/package.json             packages/kata-sdk/
COPY packages/icons/package.json                packages/icons/
COPY packages/xyne-claw-shared/package.json     packages/xyne-claw-shared/
COPY packages/xyne-claw-mcp-common/package.json packages/xyne-claw-mcp-common/
COPY apps/xyne-claw-mcp-service/package.json    apps/xyne-claw-mcp-service/

RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter xyne-claw-mcp-service...

COPY packages/kata-sdk             packages/kata-sdk
COPY packages/icons                packages/icons
COPY packages/xyne-claw-shared     packages/xyne-claw-shared
COPY packages/xyne-claw-mcp-common packages/xyne-claw-mcp-common
COPY apps/xyne-claw-mcp-service    apps/xyne-claw-mcp-service

RUN pnpm --filter @xyne/icons run build
WORKDIR /repo/apps/xyne-claw-mcp-service
RUN npx tsc --noEmit

# npm MCP servers from mcp-packages/npm/package-lock.json into /opt/mcp/npm.
RUN cd mcp-packages/npm \
    && npm ci --omit=dev --no-audit --no-fund --loglevel=error \
    && mkdir -p /opt/mcp/npm \
    && mv node_modules package.json package-lock.json /opt/mcp/npm/

# github-mcp-server release binary into /opt/mcp/bin, checked against
# mcp-packages/bin/github-mcp-server_<version>_checksums.txt.
ARG TARGETARCH
ARG GITHUB_MCP_VERSION=2.1.0
RUN arch="$(case "${TARGETARCH:-$(dpkg --print-architecture)}" in amd64) echo x86_64;; arm64) echo arm64;; *) exit 1;; esac)" \
    && file="github-mcp-server_Linux_${arch}.tar.gz" \
    && mkdir -p /tmp/gh-mcp /opt/mcp/bin && cd /tmp/gh-mcp \
    && curl -fsSLO "https://github.com/github/github-mcp-server/releases/download/v${GITHUB_MCP_VERSION}/${file}" \
    && grep " ${file}\$" "/repo/apps/xyne-claw-mcp-service/mcp-packages/bin/github-mcp-server_${GITHUB_MCP_VERSION}_checksums.txt" | sha256sum -c - \
    && tar -xzf "${file}" github-mcp-server \
    && install -m 0755 github-mcp-server /opt/mcp/bin/github-mcp-server \
    && rm -rf /tmp/gh-mcp

# Python 3.13 into /opt/mcp/python, and one virtualenv per
# mcp-packages/python/<name>.txt at /opt/mcp/py/<name>.
ENV UV_PYTHON_INSTALL_DIR=/opt/mcp/python \
    UV_PYTHON_PREFERENCE=only-managed \
    UV_NO_CACHE=1
RUN uv python install 3.13 \
    && for req in mcp-packages/python/*.txt; do \
         venv="/opt/mcp/py/$(basename "$req" .txt)"; \
         uv venv --python 3.13 "$venv" \
         && uv pip install --python "$venv/bin/python" --require-hashes --no-deps --compile-bytecode -r "$req" \
         || exit 1; \
       done

# Runtime stage.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:39c66687298417dbf3ff2fb8b6012c20554494e16414ef7afd07b9abbb45b501
WORKDIR /repo/apps/xyne-claw-mcp-service

COPY --from=builder /repo /repo
COPY --from=builder /opt/mcp /opt/mcp

ENV NODE_ENV=production \
    MCP_NPM_DIR=/opt/mcp/npm \
    MCP_PY_DIR=/opt/mcp/py \
    MCP_BIN_DIR=/opt/mcp/bin

EXPOSE 3010

CMD ["--import", "tsx/esm", "src/main.ts"]

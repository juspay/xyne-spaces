# syntax=docker/dockerfile:1.4
FROM node:22.23.4-trixie-slim AS server

WORKDIR /app
COPY agent-workspace/package.json agent-workspace/package-lock.json agent-workspace/tsconfig.json /app/
RUN npm ci --no-audit --no-fund
COPY agent-workspace/src /app/src
RUN npx tsc -p . \
 && npm uninstall tsx --no-audit --no-fund \
 && rm -rf node_modules \
 && npm ci --omit=dev --no-audit --no-fund

FROM debian:trixie-20261123-slim AS python

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

COPY workflows-sandbox/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --only-binary=:all: -r /tmp/requirements.txt \
 && /opt/venv/bin/pip uninstall -y pip

FROM debian:trixie-20261123-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1000 sandbox \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash sandbox \
 && mkdir -p /workspace \
 && chown 1000:1000 /workspace

COPY --from=server /usr/local/bin/node /usr/local/bin/node
COPY --from=server /app/package.json /app/package.json
COPY --from=server /app/node_modules /app/node_modules
COPY --from=server /app/dist /app/dist
COPY --from=python /opt/venv /opt/venv

ENV PATH=/opt/venv/bin:$PATH
RUN echo 'export PATH=/opt/venv/bin:$PATH' > /etc/profile.d/venv.sh

USER 1000:1000
WORKDIR /app
EXPOSE 8888
CMD ["node", "/app/dist/main.js"]

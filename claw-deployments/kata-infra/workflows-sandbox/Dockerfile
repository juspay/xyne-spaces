# syntax=docker/dockerfile:1.4
FROM node:22.23.4-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

COPY workflows-sandbox/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --only-binary=:all: -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt
ENV PATH=/opt/venv/bin:$PATH
RUN echo 'export PATH=/opt/venv/bin:$PATH' > /etc/profile.d/venv.sh

WORKDIR /app
COPY agent-workspace/package.json agent-workspace/package-lock.json agent-workspace/tsconfig.json /app/
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY agent-workspace/src /app/src
RUN mkdir -p /workspace && chown 1000:1000 /workspace

USER 1000:1000
EXPOSE 8888
CMD ["node", "--import", "tsx/esm", "/app/src/main.ts"]

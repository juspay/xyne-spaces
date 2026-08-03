# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app

COPY package*.json ./
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --no-frozen-lockfile

# pnpm v10 blocks @getgauge/cli's install script; run it explicitly to fetch the gauge binary.
RUN cd node_modules/@getgauge/cli && node src/index.js
RUN pnpm exec gauge install ts && pnpm exec gauge install html-report

COPY . .

RUN mkdir -p /app/reports

CMD ["tail", "-f", "/dev/null"]

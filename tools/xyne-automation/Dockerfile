# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app

COPY package*.json ./
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .

RUN mkdir -p /app/reports

CMD ["tail", "-f", "/dev/null"]

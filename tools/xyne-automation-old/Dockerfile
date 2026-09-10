FROM mcr.microsoft.com/playwright:v1.57.0-noble
WORKDIR /app

COPY package*.json ./
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
RUN pnpm install --frozen-lockfile

COPY . .

RUN mkdir -p /app/report

CMD ["tail", "-f", "/dev/null"]

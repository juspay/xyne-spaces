FROM mcr.microsoft.com/playwright:v1.57.0-noble
WORKDIR /app

COPY package*.json ./
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
RUN pnpm install --frozen-lockfile

COPY . .

RUN mkdir -p /app/report

# The Playwright base image ships a non-root "pwuser"; run as it and give it /app
# so report/artifact writes at runtime succeed without root.
RUN chown -R pwuser:pwuser /app
USER pwuser

CMD ["tail", "-f", "/dev/null"]

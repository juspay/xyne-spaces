# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app

COPY package*.json ./
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --no-frozen-lockfile

# pnpm v10 blocks @getgauge/cli's install script; run it explicitly to fetch the gauge binary.
RUN cd node_modules/@getgauge/cli && node src/index.js

COPY . .

RUN mkdir -p /app/reports

# The Playwright base image ships a non-root "pwuser"; run as it and give it /app
# so report/artifact writes at runtime succeed without root.
RUN chown -R pwuser:pwuser /app
USER pwuser

# Install gauge plugins + corepack pnpm as pwuser (the runtime user) so they cache
# in its home, not /root — otherwise the runtime re-downloads pnpm and re-installs
# plugins each run. Pre-create the global gauge config to silence its missing-file warning.
RUN corepack prepare pnpm@10.15.0 --activate \
  && mkdir -p /home/pwuser/.gauge/config \
  && : > /home/pwuser/.gauge/config/gauge.properties \
  && pnpm exec gauge install ts \
  && pnpm exec gauge install html-report \
  && pnpm exec gauge install screenshot

CMD ["tail", "-f", "/dev/null"]

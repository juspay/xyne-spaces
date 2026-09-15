# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app

COPY package*.json ./
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --no-frozen-lockfile --ignore-scripts

RUN cd node_modules/@getgauge/cli && \
    version=$(node -pe "require('./package.json').version") && \
    case "$(uname -m)" in x86_64) arch=x86_64 ;; aarch64|arm64) arch=arm64 ;; *) echo "unsupported arch: $(uname -m)" && exit 1 ;; esac && \
    url="https://github.com/getgauge/gauge/releases/download/v${version}/gauge-${version}-linux.${arch}.zip" && \
    curl -fsSL -o /tmp/gauge.zip "$url" && \
    node -e "const AdmZip=require('adm-zip'); new AdmZip('/tmp/gauge.zip').extractAllTo('bin', true, true)" && \
    rm /tmp/gauge.zip

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

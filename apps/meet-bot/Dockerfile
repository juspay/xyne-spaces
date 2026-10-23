# Xyne Automatic notetaker bot: a real (headed) browser on a virtual screen.
# Build from the repo root:  docker build -f apps/meet-bot/Dockerfile .
# Same image locally (docker-compose.dev.yml, service meet-bot) and in production.
FROM mirror.gcr.io/library/node:22.22.3-slim AS base

# Retry flaky package downloads instead of failing the build.
RUN echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries

# Xvfb gives Chrome a screen (Meet refuses headless Chrome). PulseAudio gives it an
# audio output device; without one, WebRTC never decodes the meeting's audio.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg xvfb xauth pulseaudio dbus-x11 \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Google Chrome on amd64. Google ships no Linux arm64 Chrome (Apple-silicon Macs
# build arm64 images), so arm64 uses Debian's Chromium.
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
      && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
         > /etc/apt/sources.list.d/google-chrome.list \
      && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
      && ln -s /usr/bin/google-chrome-stable /usr/local/bin/meet-bot-chrome; \
    else \
      apt-get update && apt-get install -y --no-install-recommends chromium \
      && ln -s /usr/bin/chromium /usr/local/bin/meet-bot-chrome; \
    fi \
    && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/meet-bot/package.json apps/meet-bot/
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile --prod=false --ignore-scripts --filter meet-bot
COPY apps/meet-bot/tsconfig.json apps/meet-bot/
COPY apps/meet-bot/src apps/meet-bot/src
RUN pnpm --filter meet-bot run typecheck

FROM base AS runner
RUN groupadd --system --gid 1001 bot && useradd --system --uid 1001 --gid bot --create-home bot
COPY --from=builder --chown=bot:bot /repo /repo
COPY apps/meet-bot/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
WORKDIR /repo/apps/meet-bot
USER bot

ENV NODE_ENV=production \
    PORT=3010 \
    DISPLAY=:99 \
    CHROME_PATH=/usr/local/bin/meet-bot-chrome
# The bot signs in with SSO (src/sso.ts): give it SSO_EMAIL, SSO_PRIVATE_KEY and
# SSO_CERTIFICATE (or *_FILE paths to mounted secrets). Nothing to keep on disk.
EXPOSE 3010
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "tsx/esm", "src/main.ts"]

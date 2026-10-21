# syntax=docker/dockerfile:1.4
FROM node:22-slim

ARG user=nixuser
ARG group=xyne
ARG NIX_VERSION=2.18.9
ARG CODE_SERVER_VERSION=4.96.4

ENV DEBIAN_FRONTEND=noninteractive

USER root
WORKDIR /

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      sudo \
      git \
      openssh-client \
      chromium \
      chromium-driver \
      xvfb \
      x11vnc \
      novnc \
      python3-websockify \
      netcat-openbsd \
      locales \
      xz-utils \
 && sed -i '/^# en_US.UTF-8 UTF-8/s/^# //' /etc/locale.gen \
 && locale-gen \
 && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

RUN userdel --remove node 2>/dev/null || true \
 && groupadd --gid 1000 ${group} \
 && useradd  --uid 1000 --gid ${group} --create-home --home-dir /home/${user} --shell /bin/bash ${user} \
 && mkdir -m 0755 /nix \
 && chown ${user}:${group} /nix \
 && mkdir -p /home/${user}/.ssh \
 && chown -R ${user}:${group} /home/${user} \
 && chmod 700 /home/${user}/.ssh \
 && echo "${user} ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/${user}

USER ${user}
ENV HOME=/home/${user}
WORKDIR /home/${user}

RUN curl -fL https://releases.nixos.org/nix/nix-${NIX_VERSION}/install -o /tmp/nix.install.sh \
 && bash /tmp/nix.install.sh --no-daemon \
 && rm /tmp/nix.install.sh

ENV NIX_LINK=/home/${user}/.nix-profile
ENV NIX_PATH=nixpkgs=/home/${user}/.nix-defexpr/channels/nixpkgs
ENV PATH=/home/${user}/.nix-profile/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN mkdir -p /home/${user}/.config/nix && cat > /home/${user}/.config/nix/nix.conf <<EOF
experimental-features = nix-command flakes
sandbox = false
max-jobs = auto
http-connections = 256
http2 = true
substituters = https://cache.nixos.org
trusted-public-keys = cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=
fallback = true
EOF

RUN . /home/${user}/.nix-profile/etc/profile.d/nix.sh \
 && nix profile install --impure nixpkgs#just

USER root
RUN mkdir -p /app && chown -R ${user}:${group} /app \
 && mkdir -p /home/${user}/workspace \
 && chown -R ${user}:${group} /home/${user}/workspace \
 && ln -sfn /home/${user}/workspace /workspace

USER ${user}
WORKDIR /app
COPY --chown=${user}:${group} package*.json tsconfig.json /app/
RUN npm ci --no-audit --no-fund
COPY --chown=${user}:${group} src /app/src

USER root
ENV NODE_PATH=/usr/local/lib/node_modules
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/lib/playwright-browsers
RUN mkdir -p ${PLAYWRIGHT_BROWSERS_PATH} \
 && npm install -g --cache /tmp/root-npm-cache playwright \
 && npx --yes --cache /tmp/root-npm-cache playwright install chromium-headless-shell \
 && rm -rf /tmp/root-npm-cache \
 && chown -R ${user}:${group} ${PLAYWRIGHT_BROWSERS_PATH} /home/${user}/.npm /home/${user}/.cache 2>/dev/null || true

RUN curl -fL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_amd64.deb" -o /tmp/code-server.deb \
 && apt-get update \
 && apt-get install -y --no-install-recommends /tmp/code-server.deb \
 && rm /tmp/code-server.deb \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && rm /etc/sudoers.d/${user}

RUN cat > /home/${user}/.bashrc <<'EOF'
export PATH="/home/nixuser/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"
export NIX_LINK=/home/nixuser/.nix-profile
export NIX_PATH=nixpkgs=/home/nixuser/.nix-defexpr/channels/nixpkgs
export NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
[ -f "$HOME/.nix-profile/etc/profile.d/nix.sh" ] && . "$HOME/.nix-profile/etc/profile.d/nix.sh"
EOF
RUN echo 'source $HOME/.bashrc' > /home/${user}/.profile \
 && chown ${user}:${group} /home/${user}/.bashrc /home/${user}/.profile

USER 1000:1000
WORKDIR /home/${user}
EXPOSE 8888 6080 8443 9223
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# LiveKit egress, on the upstream image with what it does not need at run time
# taken out. It cannot go distroless: it drives headless Chrome on an Xvfb
# display with pulseaudio for sound, links GStreamer through cgo, and starts
# through a bash entrypoint (/entrypoint.sh) under tini. So this keeps that
# userland and removes the rest:
#   - curl, unzip and GnuPG (gpg, dirmngr and friends), which upstream installs
#     only to fetch Chrome at build time. Egress itself only runs pactl, Xvfb,
#     Chrome and egress.
#   - the wget binary. The wget package stays installed because Chrome's .deb
#     depends on it, and purging it would uninstall Chrome.
#   - the egress user's membership of `sudo`. sudo is not installed, so this
#     only closes the door if it ever is.
# Chrome is held at the version upstream ships and tests (the image carries
# Google's apt source, so a plain upgrade would move it).
# It still runs as `egress` (uid 1001) with upstream's tini entrypoint. Its
# config file (EGRESS_CONFIG_FILE) must be readable by uid 1001.
#
#   docker build -t livekit-egress livekit-egress
#
# The base can be swapped for a mirror of the same image:
#
#   docker build --build-arg BASE_IMAGE=<mirror>/livekit/egress:v1.15.0@sha256:... ...

# livekit/egress v1.15.0 (multi-arch index).
ARG BASE_IMAGE=docker.io/livekit/egress:v1.15.0@sha256:ac244a40268ce1dd1510fbff6eb529609ec68aceff1602343f79be8ca08c355b

FROM ${BASE_IMAGE}
USER root
# Upgrade picks up OS security fixes published since upstream's build.
RUN apt-mark hold google-chrome-stable \
    && apt-get update \
    && apt-get -y upgrade \
    && apt-get purge -y curl unzip gnupg gpg dirmngr gpg-agent gpgsm gpg-wks-client \
    && rm -f /usr/bin/wget \
    && rm -rf /var/lib/apt/lists/* \
    && gpasswd -d egress sudo
USER egress

# Vespa, on the upstream image with the AlmaLinux 8 security updates applied.
# Upstream builds from almalinux:8 without upgrading it, so each release ships
# the OS packages of whenever its base was last pulled. This upgrades them,
# keeps the vespa rpm at the pinned version (its repo is disabled for the
# upgrade) and drops perf and vim, which nothing at run time uses.
# It still runs as `vespa` (uid 1000) with upstream's entrypoint.
#
#   docker build -t vespa vespa
#
# The base can be swapped for a mirror of the same image:
#
#   docker build --build-arg BASE_IMAGE=<mirror>/vespaengine/vespa:8.781.11@sha256:... ...

# vespaengine/vespa 8.781.11 (multi-arch index).
ARG BASE_IMAGE=docker.io/vespaengine/vespa:8.781.11@sha256:93268edd995b4e671be33babf7ebac55155fd0f330bb0b02123d1fbf3a9d1df0

FROM ${BASE_IMAGE}
USER root
RUN dnf -y upgrade --disablerepo='vespa-*' \
    && dnf -y remove perf vim-minimal \
    && dnf clean all \
    && rm -rf /var/cache/dnf /var/log/dnf* /var/log/hawkey.log
USER vespa

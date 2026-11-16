# LiveKit server, built from upstream source and run on Google's distroless
# `static` runtime: no shell, no package manager, no coreutils, not even libc,
# so a compromised server has no tools to run. livekit-server is a pure-Go
# binary built with CGO disabled, so `static` is all it needs. It runs as
# `nonroot` (uid 65532).
#
# Configured at run time, never baked in: `--config /etc/livekit/config.yaml`
# from a read-only mount, or the whole file in LIVEKIT_CONFIG. That file must be
# readable by uid 65532.
#
# There is no HEALTHCHECK, since there is no shell to run one: probe
# `GET /` on the signal port (7880) over HTTP instead.
#
#   docker build -t livekit-server livekit-server
#
# The two base images can be swapped for a mirror or another hardened base
# without editing this file:
#
#   docker build --build-arg BUILD_IMAGE=<mirror>/golang:1.27.3-alpine3.24 \
#     --build-arg RUNTIME_IMAGE=<mirror>/distroless/static-debian12:nonroot ...

# Upstream's own builder for v1.13.11 (livekit/livekit Dockerfile), and
# distroless static-debian12:nonroot as of 2026-10-29.
ARG BUILD_IMAGE=docker.io/library/golang:1.27.3-alpine3.24@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab

FROM ${BUILD_IMAGE} AS builder
# The tag is checked against its commit, so a re-pointed tag fails the build.
ARG LIVEKIT_VERSION=v1.13.11
ARG LIVEKIT_COMMIT=385aa40f9292fe1db8caad87301e4b285b7c198a
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "${LIVEKIT_VERSION}" https://github.com/livekit/livekit.git /src \
    && test "$(git -C /src rev-parse HEAD)" = "${LIVEKIT_COMMIT}"
WORKDIR /src
ENV GOTOOLCHAIN=local
RUN go mod download
# -trimpath and -s -w drop local paths and debug symbols from the binary.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/livekit-server ./cmd/server

FROM ${RUNTIME_IMAGE} AS runtime
# Root-owned, so the server cannot overwrite its own binary.
COPY --from=builder --chown=0:0 /out/livekit-server /livekit-server
USER 65532:65532
# Signal and RTC-over-TCP; media UDP uses the rtc.port_range from the config.
EXPOSE 7880 7881
ENTRYPOINT ["/livekit-server"]

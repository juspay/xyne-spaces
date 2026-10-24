# The sync server as an image: built from the locked dependencies, run as an
# unprivileged user on a slim Debian. Configured entirely by environment
# variables (docs/deploy.md lists every one); nothing is baked in but the
# listen address and the JSON log format a container platform expects.
#
#   docker build -f docker/server/Dockerfile -t streamgres .
ARG BASE_REGISTRY=docker.io/library
FROM ${BASE_REGISTRY}/rust:1.89-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock clippy.toml ./
COPY src ./src
RUN cargo build --release --locked --bin server

FROM ${BASE_REGISTRY}/debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin streamgres \
    && mkdir -p /app /var/lib/streamgres /var/lib/xyne-sync \
    && chown -R streamgres:streamgres /app /var/lib/streamgres /var/lib/xyne-sync
WORKDIR /app
COPY --from=builder /build/target/release/server /app/server

ARG SOURCE_COMMIT=unknown
ENV SOURCE_COMMIT=${SOURCE_COMMIT} \
    STREAMGRES_ADDR=0.0.0.0:4848 \
    STREAMGRES_LOG_FORMAT=json

USER streamgres
EXPOSE 4848
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
    CMD curl -fsS http://127.0.0.1:4848/health || exit 1
CMD ["/app/server"]

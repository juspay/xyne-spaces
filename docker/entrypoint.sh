#!/bin/bash
set -e

# =============================================================================
# Shared entrypoint for both dev-infra and call-services containers.
# CONTAINER_TYPE env var (set in each Dockerfile) determines behavior.
# =============================================================================

if [ "$CONTAINER_TYPE" = "call-services" ]; then
    # ---- call-services container -------------------------------------------
    supervisord -n -c /etc/supervisor/conf.d/supervisord.conf &
    SUPERVISOR_PID=$!

    for i in $(seq 1 10); do
        if supervisorctl status > /dev/null 2>&1; then break; fi
        sleep 0.5
    done

    if [ "${ENABLE_TRANSCRIPTION:-0}" = "1" ]; then
        supervisorctl start transcription-agent 2>/dev/null || true
        echo "[entrypoint] Started: transcription-agent"
    fi

    if [ "${ENABLE_EGRESS:-0}" = "1" ]; then
        supervisorctl start egress 2>/dev/null || true
        echo "[entrypoint] Started: egress"
    fi

    wait $SUPERVISOR_PID
    exit 0
fi

# ---- dev-infra container -----------------------------------------------------
PG_BIN="/usr/lib/postgresql/16/bin"
PG_DATA="/var/lib/postgresql/data"

# PostgreSQL first-run init
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    echo "[entrypoint] Initialising PostgreSQL cluster..."
    su - postgres -c "$PG_BIN/initdb -D $PG_DATA --encoding=UTF8 --locale=C"
    cat > "$PG_DATA/pg_hba.conf" <<'HBA'
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
host    all             all             0.0.0.0/0               trust
host    all             all             ::/0                    trust
HBA
    cat > "$PG_DATA/postgresql.conf" <<CONF
listen_addresses = '*'
port = 5432
max_connections = 300
shared_buffers = 128MB
wal_level = logical
max_replication_slots = 20
max_wal_senders = 20
unix_socket_directories = '/var/run/postgresql'
CONF
    su - postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -o '-c listen_addresses=localhost' -w start"
    su - postgres -c "psql -v ON_ERROR_STOP=1 <<'SQL'
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'xyne') THEN
        CREATE ROLE xyne WITH LOGIN PASSWORD 'xyne123' SUPERUSER;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'claw') THEN
        CREATE ROLE claw WITH LOGIN PASSWORD 'claw123';
    END IF;
END
\$\$;
SELECT 'CREATE DATABASE xyne_dev_db OWNER xyne' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'xyne_dev_db')\gexec
SELECT 'CREATE DATABASE xyne_common OWNER xyne' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'xyne_common')\gexec
SELECT 'CREATE DATABASE claw_auth_db OWNER claw' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'claw_auth_db')\gexec
SQL"
    su - postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -w stop"
    echo "[entrypoint] PostgreSQL ready: xyne_dev_db, xyne_common, claw_auth_db"
else
    echo "[entrypoint] PostgreSQL cluster already exists."
fi

# Zero-cache default env
export ZERO_UPSTREAM_DB=${ZERO_UPSTREAM_DB:-postgresql://xyne:xyne123@localhost:5432/xyne_dev_db}
export ZERO_CVR_DB=${ZERO_CVR_DB:-postgresql://xyne:xyne123@localhost:5432/xyne_dev_db}
export ZERO_CHANGE_DB=${ZERO_CHANGE_DB:-postgresql://xyne:xyne123@localhost:5432/xyne_dev_db}
export ZERO_REPLICA_FILE=${ZERO_REPLICA_FILE:-/var/zero/replica.db}
export ZERO_LOG_LEVEL=${ZERO_LOG_LEVEL:-info}
export ZERO_PORT=${ZERO_PORT:-4848}
export ZERO_ADMIN_PASSWORD=${ZERO_ADMIN_PASSWORD:-dev-admin-password}
export ZERO_MUTATE_URL=${ZERO_MUTATE_URL:-http://host.docker.internal:3001/api/zero/push}
export ZERO_QUERY_URL=${ZERO_QUERY_URL:-http://host.docker.internal:3001/api/zero/query}
export ZERO_QUERY_FORWARD_COOKIES=${ZERO_QUERY_FORWARD_COOKIES:-true}
export ZERO_MUTATE_FORWARD_COOKIES=${ZERO_MUTATE_FORWARD_COOKIES:-true}
export ZERO_CVR_MAX_CONNS=${ZERO_CVR_MAX_CONNS:-10}
export ZERO_UPSTREAM_MAX_CONNS=${ZERO_UPSTREAM_MAX_CONNS:-10}
export ZERO_NUM_SYNC_WORKERS=${ZERO_NUM_SYNC_WORKERS:-5}
export NODE_ENV=${NODE_ENV:-development}

# OTEL (only when observability enabled)
if [ "${ENABLE_OBSERVABILITY:-0}" = "1" ]; then
    export OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}
else
    unset OTEL_EXPORTER_OTLP_ENDPOINT 2>/dev/null || true
fi

# Start supervisord (core programs auto-start)
supervisord -n -c /etc/supervisor/supervisord.conf &
SUPERVISOR_PID=$!

for i in $(seq 1 10); do
    if supervisorctl status > /dev/null 2>&1; then break; fi
    sleep 0.5
done

# Start optional programs
start_if() {
    local flag="$1"; shift
    local programs="$@"
    if [ "${!flag:-0}" = "1" ]; then
        for prog in $programs; do
            supervisorctl start "$prog" 2>/dev/null || true
        done
        echo "[entrypoint] Started: $programs (triggered by $flag)"
    fi
}

start_if ENABLE_STORAGE       fake-gcs minio ysweet
start_if ENABLE_CALLS         livekit
start_if ENABLE_FEATURE_FLAGS superposition
start_if ENABLE_OBSERVABILITY otel-collector victoriametrics grafana

wait $SUPERVISOR_PID

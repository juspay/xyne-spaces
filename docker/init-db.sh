#!/bin/sh
set -e

# Runs once, the first time the PostgreSQL container initialises its data
# directory. Creates every logical database the stack needs inside this single
# instance — there is no reason to run three Postgres containers locally when one
# cluster holds three databases just as well.
#
#   xyne_dev_db   application data       (owner: xyne, created from POSTGRES_DB)
#   xyne_common   shared reference data  (owner: xyne)
#   claw_auth_db  claw-auth credentials  (owner: claw)
#
# Postgres only executes /docker-entrypoint-initdb.d on an *empty* data
# directory, so editing this file has no effect on an existing volume. To pick up
# changes: docker compose down -v (destroys local data), then start again.

echo "Initializing Xyne Spaces databases..."

# claw-auth connects as its own role. It is created here because it used to come
# from a separate container with its own POSTGRES_USER.
CLAW_USER="${CLAW_DB_USER:-claw}"
CLAW_PASSWORD="${CLAW_DB_PASSWORD:-claw123}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${CLAW_USER}') THEN
            CREATE ROLE ${CLAW_USER} LOGIN PASSWORD '${CLAW_PASSWORD}';
        END IF;
    END
    \$\$;
EOSQL

# CREATE DATABASE cannot run inside a transaction or a DO block, so each one is
# checked first and then issued as its own statement.
create_db() {
    db_name="$1"
    db_owner="$2"
    exists=$(psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" \
        --username "$POSTGRES_USER" --dbname "postgres")
    if [ "$exists" = "1" ]; then
        echo "  ${db_name} already exists"
    else
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" \
            -c "CREATE DATABASE ${db_name} OWNER ${db_owner};"
        echo "  created ${db_name} (owner ${db_owner})"
    fi
}

create_db "xyne_common" "$POSTGRES_USER"
create_db "claw_auth_db" "$CLAW_USER"

# The backend's common schema lives in a named schema, not public — see
# COMMON_DATABASE_URL's ?schema=common.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "xyne_common" <<-EOSQL
    CREATE SCHEMA IF NOT EXISTS common AUTHORIZATION ${POSTGRES_USER};
EOSQL

# Zero replicates from the application database, which needs logical decoding.
# These are cluster-wide and need a restart, which the entrypoint does after the
# init scripts finish.
echo "Configuring PostgreSQL for Zero (WAL level = logical)..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    ALTER SYSTEM SET wal_level = logical;
    ALTER SYSTEM SET max_replication_slots = 20;
    ALTER SYSTEM SET max_wal_senders = 20;
    ALTER SYSTEM SET max_connections = 300;
    SELECT pg_reload_conf();
EOSQL

echo "Database initialization complete."

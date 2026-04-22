#!/bin/sh
set -e

# This script runs when the PostgreSQL container starts for the first time
# It initializes the database for Xyne Spaces

echo "Initializing Xyne Spaces database..."

# Create the database if it doesn't exist (already created by POSTGRES_DB env var)
# Just ensure it's ready
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Add any initial database setup here if needed
    SELECT 'Database initialized successfully' AS status;
EOSQL

# Configure WAL level for Zero (Change Data Capture)
echo "Configuring PostgreSQL for Zero (WAL level = logical)..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    ALTER SYSTEM SET wal_level = logical;
    ALTER SYSTEM SET max_replication_slots = 20;
    ALTER SYSTEM SET max_wal_senders = 20;
    ALTER SYSTEM SET max_connections = 300;
    SELECT pg_reload_conf();
EOSQL

echo "Database initialization complete! Restart PostgreSQL for WAL changes to take effect."

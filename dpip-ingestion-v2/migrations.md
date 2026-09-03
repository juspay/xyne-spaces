# DPIP v2 database migrations

Branch: `feature/dpip-daily-injestion`

These tables live in their **own database** (`dpip_v2`) on the **same Cloud
SQL instance** as v1. A Postgres database is a fully isolated namespace, so
the table, constraint, and trigger names are identical to v1's — nothing
collides, and no suffix is needed.

Because this is a fresh database, nothing from v1's migrations exists here:
schema `dpip` and the function `dpip.set_updated_at()` are both created
below.

## Prerequisites

Run once, as an admin user, connected to any database on the instance:

```sql
CREATE DATABASE dpip_v2;
```

Then connect **to `dpip_v2`** and run Migration 1. Everything below assumes
that connection; running it against the v1 database would fail on
`CREATE SCHEMA` conflicts.

The Cloud Run v2 service is pointed here purely by its `DB_NAME=dpip_v2`
environment variable. Its `DB_USER` needs `CREATE` on this database.

## Migration 1

```sql
BEGIN;

CREATE SCHEMA IF NOT EXISTS dpip;

CREATE TABLE dpip.reports (
  identifier_type TEXT NOT NULL
    CHECK (btrim(identifier_type) <> ''),
  reported_date DATE NOT NULL,
  party_id TEXT NOT NULL
    CHECK (btrim(party_id) <> ''),
  sub_source TEXT NOT NULL
    CHECK (btrim(sub_source) <> ''),
  status TEXT NOT NULL
    CHECK (btrim(status) <> ''),
  customer_type TEXT NOT NULL
    CHECK (customer_type IN ('INDIVIDUAL', 'MERCHANT', 'ALL')),
  metrics_type TEXT NOT NULL
    CHECK (
      metrics_type IN (
        'reports_count',
        'identifiers_count',
        'external_entities_count',
        'clusters_count'
      )
    ),
  metrics_value BIGINT NOT NULL
    CHECK (metrics_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reports_unique_key UNIQUE (
    identifier_type,
    reported_date,
    party_id,
    sub_source,
    status,
    customer_type,
    metrics_type
  )
);

CREATE TABLE dpip.screenings (
  screening_date DATE NOT NULL,
  party_id TEXT NOT NULL
    CHECK (btrim(party_id) <> ''),
  event_type TEXT NOT NULL
    CHECK (btrim(event_type) <> ''),
  screening_status TEXT NOT NULL
    CHECK (btrim(screening_status) <> ''),
  count BIGINT NOT NULL
    CHECK (count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT screenings_unique_key UNIQUE (
    screening_date,
    party_id,
    event_type,
    screening_status
  )
);

CREATE TABLE dpip.cluster_external_entities (
  cluster_count BIGINT NOT NULL
    CHECK (cluster_count >= 0),
  num_external_entities BIGINT NOT NULL
    CHECK (num_external_entities >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT cluster_external_entities_unique_key UNIQUE (
    num_external_entities,
    last_updated_date
  )
);

CREATE TABLE dpip.external_entity_identifiers (
  party_id TEXT NOT NULL
    CHECK (btrim(party_id) <> ''),
  external_entity_count BIGINT NOT NULL
    CHECK (external_entity_count >= 0),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT external_entity_identifiers_unique_key UNIQUE (
    party_id,
    num_identifiers,
    last_updated_date
  )
);

CREATE TABLE dpip.cluster_identifiers (
  cluster_count BIGINT NOT NULL
    CHECK (cluster_count >= 0),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT cluster_identifiers_unique_key UNIQUE (
    num_identifiers,
    last_updated_date
  )
);

CREATE TABLE dpip.party_identifiers (
  party_ids TEXT NOT NULL
    CHECK (btrim(party_ids) <> ''),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT party_identifiers_unique_key UNIQUE (
    party_ids,
    last_updated_date
  )
);

CREATE TABLE dpip.entities_by_customer (
  customer_type TEXT NOT NULL
    CHECK (customer_type IN ('INDIVIDUAL', 'MERCHANT', 'ALL')),
  entity_count BIGINT NOT NULL
    CHECK (entity_count >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT entities_by_customer_unique_key UNIQUE (
    customer_type,
    last_updated_date
  )
);

CREATE FUNCTION dpip.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_set_updated_at
BEFORE UPDATE ON dpip.reports
FOR EACH ROW
EXECUTE FUNCTION dpip.set_updated_at();

CREATE TRIGGER screenings_set_updated_at
BEFORE UPDATE ON dpip.screenings
FOR EACH ROW
EXECUTE FUNCTION dpip.set_updated_at();

COMMENT ON COLUMN dpip.reports.identifier_type IS
  'Identifier type from the source, including the literal value ALL.';

COMMENT ON COLUMN dpip.reports.customer_type IS
  'Reporter-asserted customer segment: INDIVIDUAL, MERCHANT, or the ALL rollup.';

COMMENT ON COLUMN dpip.reports.metrics_type IS
  'One scalar metric type per report row.';

COMMENT ON COLUMN dpip.reports.metrics_value IS
  'The non-negative value for the row metric type.';

COMMENT ON COLUMN dpip.screenings.event_type IS
  'Screening event type from the source, including the literal value ALL.';

COMMENT ON COLUMN dpip.external_entity_identifiers.party_id IS
  'Lowercase party ID, or the literal text value ''null'' when unavailable.';

COMMENT ON TABLE dpip.entities_by_customer IS
  'Distinct flagged external entities split by the customer segment they were reported under. INDIVIDUAL + MERCHANT can exceed ALL: an entity reported under both counts once in each.';

COMMIT;
```

## Verification

Connected to `dpip_v2`:

```sql
SELECT current_database();

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'dpip'
ORDER BY table_name;
```

Expect `dpip_v2` and exactly seven tables:

```
cluster_external_entities
cluster_identifiers
entities_by_customer
external_entity_identifiers
party_identifiers
reports
screenings
```

## Rollback

Because v2 owns the whole database, teardown is one statement — run it from
a connection to a *different* database on the instance:

```sql
DROP DATABASE dpip_v2;
```

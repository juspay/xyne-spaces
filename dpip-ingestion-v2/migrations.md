# DPIP v2 database migrations

Branch: `feature/dpip-daily-injestion`

These tables live in the same database and the same `dpip` schema as v1,
on the same Cloud SQL instance. Every v2 table name carries a `_v2` suffix, so
nothing collides with v1's tables, constraints, or triggers.

## Prerequisites

No new database is created. Connect to the same database v1 uses — the
value of `DB_NAME` on the v1 Cloud Run service — and run Migration 1 there.

The v2 Cloud Run service must be given that same `DB_NAME`. Its `DB_USER` needs
`CREATE` on schema `dpip`.

## Migration 1

```sql
BEGIN;

CREATE SCHEMA IF NOT EXISTS dpip;

CREATE TABLE dpip.reports_v2 (
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
  CONSTRAINT reports_v2_unique_key UNIQUE (
    identifier_type,
    reported_date,
    party_id,
    sub_source,
    status,
    customer_type,
    metrics_type
  )
);

CREATE TABLE dpip.screenings_v2 (
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
  CONSTRAINT screenings_v2_unique_key UNIQUE (
    screening_date,
    party_id,
    event_type,
    screening_status
  )
);

CREATE TABLE dpip.cluster_external_entities_v2 (
  cluster_count BIGINT NOT NULL
    CHECK (cluster_count >= 0),
  num_external_entities BIGINT NOT NULL
    CHECK (num_external_entities >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT cluster_external_entities_v2_unique_key UNIQUE (
    num_external_entities,
    last_updated_date
  )
);

CREATE TABLE dpip.external_entity_identifiers_v2 (
  party_id TEXT NOT NULL
    CHECK (btrim(party_id) <> ''),
  external_entity_count BIGINT NOT NULL
    CHECK (external_entity_count >= 0),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT external_entity_identifiers_v2_unique_key UNIQUE (
    party_id,
    num_identifiers,
    last_updated_date
  )
);

CREATE TABLE dpip.cluster_identifiers_v2 (
  cluster_count BIGINT NOT NULL
    CHECK (cluster_count >= 0),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT cluster_identifiers_v2_unique_key UNIQUE (
    num_identifiers,
    last_updated_date
  )
);

CREATE TABLE dpip.party_identifiers_v2 (
  party_ids TEXT NOT NULL
    CHECK (btrim(party_ids) <> ''),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT party_identifiers_v2_unique_key UNIQUE (
    party_ids,
    last_updated_date
  )
);

CREATE TABLE dpip.entities_by_customer_v2 (
  party_id TEXT NOT NULL,
  customer_type TEXT NOT NULL
    CHECK (customer_type IN ('INDIVIDUAL', 'MERCHANT', 'ALL')),
  entity_count BIGINT NOT NULL
    CHECK (entity_count >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT entities_by_customer_v2_unique_key UNIQUE (
    party_id,
    customer_type,
    last_updated_date
  )
);

CREATE OR REPLACE FUNCTION dpip.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_v2_set_updated_at
BEFORE UPDATE ON dpip.reports_v2
FOR EACH ROW
EXECUTE FUNCTION dpip.set_updated_at();

CREATE TRIGGER screenings_v2_set_updated_at
BEFORE UPDATE ON dpip.screenings_v2
FOR EACH ROW
EXECUTE FUNCTION dpip.set_updated_at();

COMMENT ON COLUMN dpip.reports_v2.identifier_type IS
  'Identifier type from the source, including the literal value ALL.';

COMMENT ON COLUMN dpip.reports_v2.customer_type IS
  'Reporter-asserted customer segment: INDIVIDUAL, MERCHANT, or the ALL rollup.';

COMMENT ON COLUMN dpip.reports_v2.metrics_type IS
  'One scalar metric type per report row.';

COMMENT ON COLUMN dpip.reports_v2.metrics_value IS
  'The non-negative value for the row metric type.';

COMMENT ON COLUMN dpip.screenings_v2.event_type IS
  'Screening event type from the source, including the literal value ALL.';

COMMENT ON COLUMN dpip.external_entity_identifiers_v2.party_id IS
  'Lowercase party ID, or the literal text value ''null'' when unavailable.';

COMMENT ON TABLE dpip.entities_by_customer_v2 IS
  'Distinct flagged external entities split by owning party and by the customer segment they were reported under. INDIVIDUAL + MERCHANT can exceed ALL: an entity reported under both counts once in each.';

COMMENT ON COLUMN dpip.entities_by_customer_v2.party_id IS
  'Lowercase party ID of the entity owner, or the literal text value ''all'' for the registry-wide row.';

COMMIT;
```

## Verification

Connected to the v1 database:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'dpip'
  AND table_name LIKE '%\_v2'
ORDER BY table_name;
```

Expect exactly seven tables:

```
cluster_external_entities_v2
cluster_identifiers_v2
entities_by_customer_v2
external_entity_identifiers_v2
party_identifiers_v2
reports_v2
screenings_v2
```

v1's seven table names are unchanged and must still be present alongside them.

## Rollback

Only the v2 tables are dropped. The schema and `dpip.set_updated_at()` stay,
because v1 still uses both.

```sql
DROP TABLE
  dpip.reports_v2,
  dpip.screenings_v2,
  dpip.cluster_external_entities_v2,
  dpip.external_entity_identifiers_v2,
  dpip.cluster_identifiers_v2,
  dpip.party_identifiers_v2,
  dpip.entities_by_customer_v2;
```

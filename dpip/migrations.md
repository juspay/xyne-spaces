# DPIP database migrations

Branch: `feature/dpip-cloud-run-ingestion-20260724`

## Migration 1

```sql
BEGIN;

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
  reports_count BIGINT NOT NULL
    CHECK (reports_count >= 0),
  identifiers_count BIGINT NOT NULL
    CHECK (identifiers_count >= 0),
  external_entities_count BIGINT NOT NULL
    CHECK (external_entities_count >= 0),
  clusters_count BIGINT NOT NULL
    CHECK (clusters_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reports_unique_key UNIQUE (
    identifier_type,
    reported_date,
    party_id,
    sub_source,
    status
  )
);

CREATE TABLE dpip.screenings (
  screening_date DATE NOT NULL,
  party_id TEXT NOT NULL
    CHECK (btrim(party_id) <> ''),
  screening_status TEXT NOT NULL
    CHECK (btrim(screening_status) <> ''),
  count BIGINT NOT NULL
    CHECK (count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT screenings_unique_key UNIQUE (
    screening_date,
    party_id,
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
    cluster_count,
    num_external_entities,
    last_updated_date
  )
);

CREATE TABLE dpip.external_entity_identifiers (
  external_entity_count BIGINT NOT NULL
    CHECK (external_entity_count >= 0),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT external_entity_identifiers_unique_key UNIQUE (
    external_entity_count,
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
    cluster_count,
    num_identifiers,
    last_updated_date
  )
);

CREATE TABLE dpip.party_identifiers (
  party_ids BIGINT NOT NULL
    CHECK (party_ids >= 0),
  num_identifiers BIGINT NOT NULL
    CHECK (num_identifiers >= 0),
  last_updated_date DATE NOT NULL,
  CONSTRAINT party_identifiers_unique_key UNIQUE (
    party_ids,
    num_identifiers,
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

COMMIT;
```

## Migration 2

```sql
BEGIN;

ALTER TABLE dpip.party_identifiers
  DROP CONSTRAINT IF EXISTS party_identifiers_party_ids_check,
  ALTER COLUMN party_ids TYPE TEXT USING party_ids::TEXT;

COMMIT;
```

## Migration 3

```sql
BEGIN;

ALTER TABLE dpip.external_entity_identifiers
  ADD COLUMN party_id TEXT;

ALTER TABLE dpip.external_entity_identifiers
  ADD CONSTRAINT external_entity_identifiers_party_id_check
    CHECK (party_id IS NULL OR btrim(party_id) <> ''),
  DROP CONSTRAINT external_entity_identifiers_unique_key,
  ADD CONSTRAINT external_entity_identifiers_unique_key UNIQUE (
    party_id,
    external_entity_count,
    num_identifiers,
    last_updated_date
  );

COMMENT ON COLUMN dpip.external_entity_identifiers.party_id IS
  'NULL only for legacy rows ingested before party_id was added.';

COMMIT;
```

## Migration 4

Run `clear-all-data.sql` before this migration. This migration intentionally
does not preserve or transform old report data.

```sql
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dpip.reports LIMIT 1) THEN
    RAISE EXCEPTION
      'dpip.reports must be empty; run clear-all-data.sql first';
  END IF;
END;
$$;

ALTER TABLE dpip.reports
  DROP CONSTRAINT reports_unique_key,
  DROP COLUMN reports_count,
  DROP COLUMN identifiers_count,
  DROP COLUMN external_entities_count,
  DROP COLUMN clusters_count,
  ADD COLUMN metrics_type TEXT NOT NULL,
  ADD COLUMN metrics_value BIGINT NOT NULL,
  ADD CONSTRAINT reports_metrics_type_check
    CHECK (
      metrics_type IN (
        'reports_count',
        'identifiers_count',
        'external_entities_count',
        'clusters_count'
      )
    ),
  ADD CONSTRAINT reports_metrics_value_check
    CHECK (metrics_value >= 0),
  ADD CONSTRAINT reports_unique_key UNIQUE (
    identifier_type,
    reported_date,
    party_id,
    sub_source,
    status,
    metrics_type
  );

COMMENT ON COLUMN dpip.reports.identifier_type IS
  'Identifier type from the source, including the literal value ALL.';

COMMENT ON COLUMN dpip.reports.metrics_type IS
  'One scalar metric type per report row.';

COMMENT ON COLUMN dpip.reports.metrics_value IS
  'The non-negative value for the row metric type.';

COMMIT;
```

## Migration 5

This migration also assumes `clear-all-data.sql` has already been run.

```sql
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dpip.external_entity_identifiers
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'dpip.external_entity_identifiers must be empty; run clear-all-data.sql first';
  END IF;
END;
$$;

ALTER TABLE dpip.external_entity_identifiers
  DROP CONSTRAINT external_entity_identifiers_party_id_check,
  ALTER COLUMN party_id SET NOT NULL,
  ADD CONSTRAINT external_entity_identifiers_party_id_check
    CHECK (btrim(party_id) <> '');

COMMENT ON COLUMN dpip.external_entity_identifiers.party_id IS
  'Lowercase party ID, or the literal text value ''null'' when unavailable.';

COMMIT;
```

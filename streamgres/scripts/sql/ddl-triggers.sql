
CREATE SCHEMA IF NOT EXISTS "xyne_0";

CREATE OR REPLACE FUNCTION "xyne_0".get_trigger_context()
RETURNS record AS $$
DECLARE
  result record;
BEGIN
  SELECT COALESCE(current_query(), 'current_query() returned NULL') AS "query" into result;
  RETURN result;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "xyne_0".notice_ignore(reason TEXT, tag TEXT, target record)
RETURNS void AS $$
BEGIN
  RAISE NOTICE 'xyne_0 ignoring % % %', reason, tag,
    COALESCE(row_to_json(target)::text, '');
END
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS "xyne_0".schema_specs();
CREATE FUNCTION "xyne_0".schema_specs()
RETURNS JSON
STABLE
AS $$
WITH published_columns AS (SELECT
  pc.oid::int8 AS "oid",
  nspname AS "schema",
  pc.relnamespace::int8 AS "schemaOID" ,
  pc.relname AS "name",
  pc.relreplident AS "replicaIdentity",
  attnum AS "pos",
  attname AS "col",
  pt.typname AS "type",
  atttypid::int8 AS "typeOID",
  pt.typtype,
  elem_pt.typtype AS "elemTyptype",
  coll.collisdeterministic AS "collationIsDeterministic",
  NULLIF(atttypmod, -1) AS "maxLen",
  attndims "arrayDims",
  attnotnull AS "notNull",
  pg_get_expr(pd.adbin, pd.adrelid) as "dflt",
  NULLIF(ARRAY_POSITION(conkey, attnum), -1) AS "keyPos",
  pb.rowfilter as "rowFilter",
  pb.pubname as "publication"
FROM pg_attribute
JOIN pg_class pc ON pc.oid = attrelid
JOIN pg_namespace pns ON pns.oid = relnamespace
JOIN pg_type pt ON atttypid = pt.oid
LEFT JOIN pg_type elem_pt ON elem_pt.oid = pt.typelem
LEFT JOIN pg_collation coll ON coll.oid = pg_attribute.attcollation
JOIN pg_publication_tables as pb ON
  pb.schemaname = nspname AND
  pb.tablename = pc.relname AND
  attname = ANY(pb.attnames)
LEFT JOIN pg_constraint pk ON pk.contype = 'p' AND pk.connamespace = relnamespace AND pk.conrelid = attrelid
LEFT JOIN pg_attrdef pd ON pd.adrelid = attrelid AND pd.adnum = attnum
WHERE pb.pubname IN ('xyne_sync_pub') AND
      (current_setting('server_version_num')::int >= 160000 OR attgenerated = '')
ORDER BY nspname, pc.relname),

tables AS (SELECT json_build_object(
  'oid', "oid",
  'schema', "schema",
  'schemaOID', "schemaOID",
  'name', "name",
  'replicaIdentity', "replicaIdentity",
  'columns', json_object_agg(
    DISTINCT
    col,
    jsonb_build_object(
      'pos', "pos",
      'dataType', CASE WHEN "arrayDims" = 0
                       THEN "type"
                       ELSE substring("type" from 2) || repeat('[]', "arrayDims") END,
      'pgTypeClass', "typtype",
      'elemPgTypeClass', "elemTyptype",
      'typeOID', "typeOID",
      'collationIsDeterministic', "collationIsDeterministic",
      'characterMaximumLength', CASE WHEN "typeOID" = 1043 OR "typeOID" = 1042
                                     THEN "maxLen" - 4
                                     ELSE "maxLen" END,
      'notNull', "notNull",
      'dflt', "dflt"
    )
  ),
  'primaryKey', ARRAY( SELECT json_object_keys(
    json_strip_nulls(
      json_object_agg(
        DISTINCT "col", "keyPos" ORDER BY "keyPos"
      )
    )
  )),
  'publications', json_object_agg(
    DISTINCT
    "publication",
    jsonb_build_object('rowFilter', "rowFilter")
  )
) AS "table" FROM published_columns
  GROUP BY "schema", "schemaOID", "name", "oid", "replicaIdentity"),

  indexed_columns AS (SELECT
      pg_indexes.schemaname as "schema",
      pg_indexes.tablename as "tableName",
      pg_indexes.indexname as "name",
      index_column.name as "col",
      CASE WHEN pg_index.indoption[index_column.pos-1] & 1 = 1 THEN 'DESC' ELSE 'ASC' END as "dir",
      (pg_index.indisunique AND pg_index.indpred IS NULL) as "unique",
      pg_index.indisprimary as "isPrimaryKey",
      pg_index.indisreplident as "isReplicaIdentity",
      pg_index.indimmediate as "isImmediate",
      pg_get_expr(pg_index.indpred, pg_index.indrelid, false) as "predicateSQL"
    FROM pg_indexes
    JOIN pg_namespace ON pg_indexes.schemaname = pg_namespace.nspname
    JOIN pg_class pc ON
      pc.relname = pg_indexes.indexname
      AND pc.relnamespace = pg_namespace.oid
    JOIN pg_publication_tables as pb ON
      pb.schemaname = pg_indexes.schemaname AND
      pb.tablename = pg_indexes.tablename
    JOIN pg_index ON pg_index.indexrelid = pc.oid
    JOIN LATERAL (
      SELECT array_agg(attname) as attnames, array_agg(attgenerated != '') as generated FROM pg_attribute
        WHERE attrelid = pg_index.indrelid
          AND attnum = ANY( (pg_index.indkey::smallint[] )[:pg_index.indnkeyatts - 1] )
    ) as indexed ON true
    JOIN LATERAL (
      SELECT pg_attribute.attname as name, col.index_pos as pos
        FROM UNNEST( (pg_index.indkey::smallint[])[:pg_index.indnkeyatts - 1] )
          WITH ORDINALITY as col(table_pos, index_pos)
        JOIN pg_attribute ON attrelid = pg_index.indrelid AND attnum = col.table_pos
    ) AS index_column ON true
    LEFT JOIN pg_constraint ON pg_constraint.conindid = pc.oid
    WHERE pb.pubname IN ('xyne_sync_pub')
      AND pg_index.indexprs IS NULL
      AND (true OR pg_index.indpred IS NULL)
      AND (pg_constraint.contype IS NULL OR pg_constraint.contype IN ('p', 'u'))
      AND indexed.attnames <@ pb.attnames
      AND (current_setting('server_version_num')::int >= 160000 OR false = ALL(indexed.generated))
    ORDER BY
      pg_indexes.schemaname,
      pg_indexes.tablename,
      pg_indexes.indexname,
      index_column.pos ASC),

    indexes AS (SELECT json_build_object(
      'schema', "schema",
      'tableName', "tableName",
      'name', "name",
      'unique', "unique",
      'isPrimaryKey', "isPrimaryKey",
      'isReplicaIdentity', "isReplicaIdentity",
      'isImmediate', "isImmediate",
      'predicateSQL', "predicateSQL",
      'columns', json_object_agg("col", "dir")
    ) AS index FROM indexed_columns
      GROUP BY "schema", "tableName", "name", "unique",
         "isPrimaryKey", "isReplicaIdentity", "isImmediate", "predicateSQL")

    SELECT json_build_object(
      'tables', COALESCE((SELECT json_agg("table") FROM tables), '[]'::json),
      'indexes', COALESCE((SELECT json_agg("index") FROM indexes), '[]'::json)
    ) as "publishedSchema"
$$ LANGUAGE sql;

CREATE TABLE IF NOT EXISTS "xyne_0"."publishedSchema" (
  current JSON,
  exists BOOL PRIMARY KEY DEFAULT true CHECK (exists)
);

INSERT INTO "xyne_0"."publishedSchema" (current) VALUES ("xyne_0".schema_specs())
  ON CONFLICT (exists) DO
  UPDATE SET current = excluded.current;

CREATE OR REPLACE FUNCTION "xyne_0".update_schemas(event_type text, tag text, target record)
RETURNS void AS $$
DECLARE
  prev_schema_specs JSON;
  schema_specs JSON;
  message TEXT;
BEGIN
  SELECT current FROM "xyne_0"."publishedSchema" INTO prev_schema_specs;
  SELECT "xyne_0".schema_specs() INTO schema_specs;

  IF prev_schema_specs::text != schema_specs::text THEN
    UPDATE "xyne_0"."publishedSchema" SET current = schema_specs;
  ELSIF event_type = 'ddlStart' THEN
    prev_schema_specs = NULL;
  ELSIF event_type = 'ddlUpdate' THEN
    PERFORM "xyne_0".notice_ignore('noop', tag, target);
    RETURN;
  END IF;

  SELECT json_build_object(
    'type', event_type,
    'version', 1,
    'previousSchema', prev_schema_specs,
    'schema', schema_specs,
    'event', json_build_object('tag', tag),
    'context', "xyne_0".get_trigger_context()
  ) INTO message;

  PERFORM pg_logical_emit_message(true, 'xyne/0/ddl', message);

  RAISE NOTICE 'Emitted xyne_0 % for % %', event_type, tag,
    COALESCE(row_to_json(target)::text, '');
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "xyne_0".update_schemas()
RETURNS void AS $$
BEGIN
  PERFORM "xyne_0".update_schemas('schemaSnapshot', 'MANUAL', NULL);
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "xyne_0".emit_ddl_start()
RETURNS event_trigger AS $$
DECLARE
  schema_specs JSON;
  message TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(4353719051050729648);
  PERFORM "xyne_0".update_schemas('ddlStart', TG_TAG, NULL);
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "xyne_0".emit_ddl_end()
RETURNS event_trigger AS $$
DECLARE
  publications TEXT[];
  target RECORD;
  relevant RECORD;
  schema_specs JSON;
  message TEXT;
  event TEXT;
BEGIN
  publications := ARRAY['xyne_sync_pub'];

  SELECT objid, object_type, object_identity
    FROM pg_event_trigger_ddl_commands()
    LIMIT 1 INTO target;

  SELECT true INTO relevant;

  IF (target.object_type = 'table' AND TG_TAG != 'ALTER TABLE')
     OR target.object_type = 'table column' THEN
    SELECT ns.nspname AS "schema", c.relname AS "name" FROM pg_class AS c
      JOIN pg_namespace AS ns ON c.relnamespace = ns.oid
      JOIN pg_publication_tables AS pb ON pb.schemaname = ns.nspname AND pb.tablename = c.relname
      WHERE c.oid = target.objid AND pb.pubname = ANY (publications)
      INTO relevant;

  ELSIF target.object_type = 'index' THEN
    SELECT ns.nspname AS "schema", c.relname AS "name" FROM pg_class AS c
      JOIN pg_namespace AS ns ON c.relnamespace = ns.oid
      JOIN pg_indexes as ind ON ind.schemaname = ns.nspname AND ind.indexname = c.relname
      JOIN pg_publication_tables AS pb ON pb.schemaname = ns.nspname AND pb.tablename = ind.tablename
      WHERE c.oid = target.objid AND pb.pubname = ANY (publications)
      INTO relevant;

  ELSIF target.object_type = 'publication relation' THEN
    SELECT pb.pubname FROM pg_publication_rel AS rel
      JOIN pg_publication AS pb ON pb.oid = rel.prpubid
      WHERE rel.oid = target.objid AND pb.pubname = ANY (publications)
      INTO relevant;

  ELSIF target.object_type = 'publication namespace' THEN
    SELECT pb.pubname FROM pg_publication_namespace AS ns
      JOIN pg_publication AS pb ON pb.oid = ns.pnpubid
      WHERE ns.oid = target.objid AND pb.pubname = ANY (publications)
      INTO relevant;

  ELSIF target.object_type = 'schema' THEN
    SELECT ns.nspname AS "schema", c.relname AS "name" FROM pg_class AS c
      JOIN pg_namespace AS ns ON c.relnamespace = ns.oid
      JOIN pg_publication_tables AS pb ON pb.schemaname = ns.nspname AND pb.tablename = c.relname
      WHERE ns.oid = target.objid AND pb.pubname = ANY (publications)
      INTO relevant;

  ELSIF target.object_type = 'publication' THEN
    SELECT 1 WHERE target.object_identity = ANY (publications)
      INTO relevant;

  ELSIF TG_TAG LIKE 'CREATE %' AND target.object_type IS NULL THEN
    relevant := NULL;
  END IF;

  IF relevant IS NULL THEN
    PERFORM "xyne_0".notice_ignore('irrelevant', TG_TAG, target);
    RETURN;
  END IF;

  IF TG_TAG = 'COMMENT' THEN
    IF target.object_type != 'publication' THEN
      PERFORM "xyne_0".notice_ignore('irrelevant', TG_TAG, target);
      RETURN;
    END IF;
    PERFORM "xyne_0".update_schemas('schemaSnapshot', TG_TAG, target);
  ELSE
    PERFORM "xyne_0".update_schemas('ddlUpdate', TG_TAG, target);
  END IF;

END
$$ LANGUAGE plpgsql;

DROP EVENT TRIGGER IF EXISTS "xyne_ddl_start_0";
DROP EVENT TRIGGER IF EXISTS "xyne_ddl_end_0";

CREATE EVENT TRIGGER "xyne_ddl_start_0"
  ON ddl_command_start
  WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE', 'CREATE INDEX', 'DROP TABLE', 'DROP INDEX', 'ALTER PUBLICATION', 'ALTER SCHEMA')
  EXECUTE PROCEDURE "xyne_0".emit_ddl_start();

CREATE EVENT TRIGGER "xyne_ddl_end_0"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE', 'CREATE INDEX', 'DROP TABLE', 'DROP INDEX', 'ALTER PUBLICATION', 'ALTER SCHEMA', 'COMMENT')
  EXECUTE PROCEDURE "xyne_0".emit_ddl_end();

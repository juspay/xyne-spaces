-- RELEASE_CONFIG edges (hub -> REPOSITORY -> main release BOARD): one per hub and
-- repository, and one per board. The table's own unique key includes targetId, so it
-- would still allow a second board for the same hub and repository.
-- Zero-safe: Zero only mirrors FULL indexes into its client SQLite — it filters
-- out PARTIAL indexes by design (its published-schema step requires pg_index.indpred
-- IS NULL). Both indexes below are partial (WHERE ...), so Zero never sees them and
-- sync can't break; they exist purely for Postgres-side enforcement.
-- CONCURRENTLY: no write-blocking lock on this pre-existing table (Prisma applies
-- migrations without a wrapping txn — see 20260421190000_add_performance_indices).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sdlc_entity_links_release_config_hub_repo_key"
  ON "public"."sdlc_entity_links" ("channelId", "sourceId")
  WHERE "relationType" = 'RELEASE_CONFIG';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sdlc_entity_links_release_config_board_key"
  ON "public"."sdlc_entity_links" ("targetId")
  WHERE "relationType" = 'RELEASE_CONFIG';

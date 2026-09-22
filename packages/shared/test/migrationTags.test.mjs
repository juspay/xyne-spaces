import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMigrationTags,
  suggestMigrationTags,
  toggleMigrationTag,
} from '../dist/utils/migrationTags.js';

test('parseMigrationTags accepts arrays and JSON text, drops unknown values', () => {
  assert.deepEqual(parseMigrationTags(['breaking', 'nope', 'breaking']), ['breaking']);
  assert.deepEqual(parseMigrationTags('["downtime","manual-step"]'), ['downtime', 'manual-step']);
  assert.deepEqual(parseMigrationTags('not json'), []);
  assert.deepEqual(parseMigrationTags(null), []);
});

test('toggleMigrationTag keeps backward-compatible and breaking mutually exclusive', () => {
  assert.deepEqual(toggleMigrationTag(['backward-compatible', 'downtime'], 'breaking'), [
    'downtime',
    'breaking',
  ]);
  assert.deepEqual(toggleMigrationTag(['breaking'], 'breaking'), []);
  assert.deepEqual(toggleMigrationTag([], 'long-running'), ['long-running']);
});

test('suggestMigrationTags flags risk only, per statement', () => {
  assert.deepEqual(
    suggestMigrationTags(`
      -- DROP COLUMN in a comment must not count
      ALTER TABLE "users" ADD COLUMN "nickname" TEXT NOT NULL DEFAULT '';
      CREATE INDEX CONCURRENTLY "users_nickname_idx" ON "users"("nickname");
    `),
    [],
  );
  assert.deepEqual(
    suggestMigrationTags(`
      ALTER TABLE "users" DROP COLUMN "legacy_flag";
      ALTER TABLE "orders" ADD COLUMN "region" TEXT NOT NULL;
      CREATE UNIQUE INDEX "orders_region_idx" ON "orders"("region");
      UPDATE "orders" SET "region" = 'IN' WHERE "region" IS NULL;
    `),
    ['irreversible', 'breaking', 'long-running', 'data-backfill'],
  );
  assert.deepEqual(suggestMigrationTags('LOCK TABLE "orders" IN EXCLUSIVE MODE;'), ['downtime']);
  assert.ok(!suggestMigrationTags('CREATE TABLE t (id TEXT);').includes('backward-compatible'));
});

test('suggestMigrationTags: corpus false positives stay quiet', () => {
  // DROP NOT NULL elsewhere in the statement is not a NOT NULL add
  assert.deepEqual(
    suggestMigrationTags('ALTER TABLE "public"."sdlc_entity_links" ADD COLUMN "channelId" TEXT, ALTER COLUMN "repoId" DROP NOT NULL;'),
    [],
  );
  // cleanup of an enum type after the column moved to TEXT is not breaking
  assert.deepEqual(suggestMigrationTags('DROP TYPE IF EXISTS "public"."TicketStatus";'), []);
  // Prisma index on a table created in the same file is not long-running
  assert.deepEqual(
    suggestMigrationTags('CREATE TABLE "public"."w" ("id" TEXT NOT NULL, "n" TEXT, CONSTRAINT "w_pkey" PRIMARY KEY ("id")); CREATE INDEX "w_n_idx" ON "public"."w"("n");'),
    [],
  );
  // a VALUES seed is not a backfill; INSERT … SELECT is
  assert.deepEqual(suggestMigrationTags(`INSERT INTO "resources" ("id","name") VALUES ('a','b');`), []);
  assert.deepEqual(suggestMigrationTags('INSERT INTO "t2" ("id") SELECT "id" FROM "t1";'), ['data-backfill']);
  // NOT NULL without default on an existing table still flags
  assert.deepEqual(suggestMigrationTags('ALTER TABLE "workflow"."c" ADD COLUMN "authType" TEXT NOT NULL;'), ['breaking']);
  // enum → text keeps every reader (and Zero's string mapping) working; text → jsonb does not
  assert.deepEqual(suggestMigrationTags(`ALTER TABLE "public"."users" ALTER COLUMN "role" TYPE text USING "role"::text;`), []);
  assert.deepEqual(suggestMigrationTags('ALTER TABLE "public"."users" ALTER COLUMN "prefs" TYPE jsonb USING "prefs"::jsonb;'), ['breaking']);
});

import { analyzeMigrationSql, isZeroBackedRepo } from '../dist/utils/migrationTags.js';

const zeroTables = new Set(['tickets', 'users', 'canvases']);
const zeroTags = sql => analyzeMigrationSql(sql, zeroTables).filter(f => f.tag.startsWith('zero-'));

test('isZeroBackedRepo only matches the xyne-spaces repos', () => {
  assert.equal(isZeroBackedRepo('https://github.com/juspay/xyne-spaces'), true);
  assert.equal(isZeroBackedRepo('https://github.com/juspay/xyne-spaces.git'), true);
  assert.equal(isZeroBackedRepo('git@github.com:juspay/xyne-spaces-private.git'), true);
  assert.equal(isZeroBackedRepo('https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces'), true);
  assert.equal(isZeroBackedRepo('https://github.com/sumantop/release-e2e-test.git'), false);
  assert.equal(isZeroBackedRepo(null), false);
});

test('Zero rules stay silent without a zero table set', () => {
  assert.deepEqual(
    analyzeMigrationSql('ALTER TABLE "tickets" DROP COLUMN "x";').map(f => f.tag),
    ['irreversible', 'breaking'],
  );
});

test('Zero: contract on synced tables only, Prisma-style and bare quoting', () => {
  assert.deepEqual(zeroTags('ALTER TABLE "public"."tickets" DROP COLUMN "legacy";').map(f => f.tag), ['zero-contract']);
  assert.deepEqual(zeroTags('ALTER TABLE users RENAME COLUMN nickname TO display_name;').map(f => f.tag), ['zero-contract']);
  assert.deepEqual(zeroTags('ALTER TABLE "canvases" ALTER COLUMN "content" SET DATA TYPE JSONB;').map(f => f.tag), ['zero-contract']);
  assert.deepEqual(zeroTags('ALTER TABLE "public"."users" ALTER COLUMN "role" TYPE text USING "role"::text;'), []);
  assert.deepEqual(zeroTags('DROP TABLE "public"."canvases";').map(f => f.tag), ['zero-contract']);
  // not synced → nothing, non_zero schema → nothing
  assert.deepEqual(zeroTags('ALTER TABLE "public"."audit_log" DROP COLUMN "x";'), []);
  assert.deepEqual(zeroTags('ALTER TABLE "non_zero"."tickets" DROP COLUMN "x"; DROP TABLE "non_zero"."users";'), []);
});

test('Zero: expand on add column / new public table; keyed tables are not unsafe', () => {
  assert.deepEqual(zeroTags('ALTER TABLE "public"."tickets" ADD COLUMN "tags" TEXT[];').map(f => f.tag), ['zero-expand']);
  const prismaCreate = `
    CREATE TABLE "public"."widgets" ("id" TEXT NOT NULL, "name" TEXT, CONSTRAINT "widgets_pkey" PRIMARY KEY ("id"));
    CREATE INDEX "widgets_name_idx" ON "public"."widgets"("name");`;
  assert.deepEqual(zeroTags(prismaCreate).map(f => f.tag), ['zero-expand']);
  const pkLater = `
    CREATE TABLE "public"."widgets" ("id" TEXT NOT NULL);
    ALTER TABLE "public"."widgets" ADD CONSTRAINT "widgets_pkey" PRIMARY KEY ("id");`;
  assert.deepEqual(zeroTags(pkLater).map(f => f.tag), ['zero-expand']);
  const uniqueLater = `
    CREATE TABLE "public"."widgets" ("id" TEXT NOT NULL);
    CREATE UNIQUE INDEX "widgets_id_key" ON "public"."widgets"("id");`;
  assert.deepEqual(zeroTags(uniqueLater).map(f => f.tag), ['zero-expand']);
  // ADD CONSTRAINT / ADD FOREIGN KEY on a synced table is not an expand of the row shape
  assert.deepEqual(zeroTags('ALTER TABLE "public"."tickets" ADD CONSTRAINT "t_fk" FOREIGN KEY ("boardId") REFERENCES "boards"("id");').map(f => f.tag), []);
});

test('Zero: halts replication when a public table ends up without a key', () => {
  assert.deepEqual(
    zeroTags('CREATE TABLE "public"."events_log" ("id" TEXT, "payload" JSONB);').map(f => f.tag),
    ['zero-expand', 'zero-unsafe'],
  );
  assert.deepEqual(zeroTags('CREATE TABLE "non_zero"."events_log" ("id" TEXT);'), []);
  assert.deepEqual(
    zeroTags('ALTER TABLE "public"."tickets" DROP CONSTRAINT "tickets_pkey";').map(f => f.tag),
    ['zero-unsafe'],
  );
  // PK swapped in the same statement / later in the file → keyed again, not unsafe
  assert.deepEqual(
    zeroTags('ALTER TABLE "tickets" DROP CONSTRAINT "tickets_pkey", RENAME COLUMN "ticketId" TO "id", ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");').map(f => f.tag),
    ['zero-contract'],
  );
  assert.deepEqual(
    zeroTags('ALTER TABLE "public"."users" DROP CONSTRAINT "users_pkey"; ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");'),
    [],
  );
});

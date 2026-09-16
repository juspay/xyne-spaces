import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROW_LEVEL_QUERIES,
  ROW_LEVEL_PARTITION_COLUMN,
  rowLevelEligibility,
  rowLevelEligibleForTable,
} from './rowLevelQueries';
import { SHARED_BASE_QUERIES } from './baseQueries';
import { queryMetaFor } from './queryMeta';

/**
 * ROW-LEVEL ROUTING CONTRACT enforcement (build-time guard). The row-level plane serves the ACL-stripped
 * base partitioned by workspaceId, routed to each user by `routeColumn` at fan-out. That reproduces native
 * IFF the ACL's ONLY subscriber-dependent top-level term is the owner pin (`routeColumn == subscriber`).
 * Onboarding a per-row / cursor / many:1-related query to ROW_LEVEL_QUERIES turns the build RED here,
 * before it can over-deliver in prod. This is the row-level sibling of shareability.test.ts (the gate).
 */

test('every ROW_LEVEL_QUERY is row-level eligible (owner-pin routing == ACL)', () => {
  for (const name of ROW_LEVEL_QUERIES.keys()) {
    const e = rowLevelEligibility(name);
    assert.ok(
      e.ok,
      `'${name}' is NOT row-level eligible → it must NOT be in ROW_LEVEL_QUERIES (serve it via native Zero). ${e.reason ?? ''}`,
    );
  }
});

test('every ROW_LEVEL_QUERY base partitions by workspaceId (one pipeline per workspace)', () => {
  for (const name of ROW_LEVEL_QUERIES.keys()) {
    const meta = queryMetaFor(name, { workspaceId: 'W1' });
    assert.ok(meta, `queryMetaFor('${name}') should resolve a partition`);
    assert.equal(
      meta!.partitionColumn,
      ROW_LEVEL_PARTITION_COLUMN,
      `'${name}' must partition by '${ROW_LEVEL_PARTITION_COLUMN}', got '${meta!.partitionColumn}'`,
    );
  }
});

test('ROW_LEVEL_QUERIES and SHARED_BASE_QUERIES are disjoint (two planes, two allowlists)', () => {
  for (const name of ROW_LEVEL_QUERIES.keys()) {
    assert.ok(
      !SHARED_BASE_QUERIES.has(name),
      `'${name}' is in BOTH ROW_LEVEL_QUERIES and SHARED_BASE_QUERIES — a query belongs to exactly one plane`,
    );
  }
});

// ── Negative fixtures: the predicate must REJECT non-eligible shapes by default ────────────────────

test('delayed_messages is REJECTED — its channel-access whereExists is a per-row admission arm', () => {
  // The owner column is `senderId`; the ACL also joins `whereExists('channel', … channelAccessWhere)`,
  // the exact per-row membership shape row-level routing cannot reproduce. Onboarding it would require a
  // product decision to drop the channel check, not a mechanical fix.
  const e = rowLevelEligibleForTable('delayed_messages', 'senderId');
  assert.equal(e.ok, false);
  assert.match(e.reason ?? '', /correlatedSubquery|per-row/i);
});

test('a wrong routeColumn is REJECTED (owner pin must be the declared route column)', () => {
  // bookmarks ACL is `userId == me`; routing by any other column would hide/misroute rows vs native.
  const e = rowLevelEligibleForTable('bookmarks', 'entityId');
  assert.equal(e.ok, false);
  assert.match(e.reason ?? '', /routeColumn/i);
});

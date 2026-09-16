import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROW_LEVEL_QUERIES,
  ROW_LEVEL_PARTITION_COLUMN,
  PROBE_WORKSPACE,
  rowLevelEligibility,
  rowLevelEligibleForTable,
  rowLevelEligibilityForBase,
  classifyAclTerms,
} from './rowLevelQueries';
import { SHARED_BASE_QUERIES } from './baseQueries';
import { queryMetaFor } from './queryMeta';
import { SENTINEL_USER, SENTINEL_MEMBER, SENTINEL_WORKSPACE, type Cond } from './aclGate';
import { zql } from '../queries';

// Build a synthetic top-level `simple` ACL term (right value can be a sentinel or a row literal).
const simple = (name: string, value: unknown, op = '='): Cond =>
  ({ type: 'simple', left: { name }, op, right: { value } } as unknown as Cond);
const and = (...conditions: Cond[]): Cond => ({ type: 'and', conditions } as unknown as Cond);
const or = (...conditions: Cond[]): Cond => ({ type: 'or', conditions } as unknown as Cond);

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

// A second subscriber-varying sentinel in the conjunct is the fail-OPEN class the classifier must
// reject: the ACL-stripped base drops it, so owner-only routing would OVER-deliver (leak-shaped).
test('a non-owner subscriber sentinel (memberId) in the conjunct is REJECTED (no fail-open)', () => {
  const acl = and(simple('userId', SENTINEL_USER), simple('memberId', SENTINEL_MEMBER));
  const e = classifyAclTerms(acl, 'userId');
  assert.equal(e.ok, false);
  assert.match(e.reason ?? '', /subscriber value|memberId/i);
});

test('a subscriber-independent literal alongside the owner pin is ALLOWED', () => {
  const acl = and(simple('userId', SENTINEL_USER), simple('isDeleted', false));
  assert.equal(classifyAclTerms(acl, 'userId').ok, true);
});

// The workspace sentinel is only the partition term on the workspaceId column; on any other column it
// is a subscriber-varying binding the base drops → reject (symmetric to the owner-pin column check).
test('a workspace sentinel on a non-partition column is REJECTED', () => {
  const acl = and(simple('userId', SENTINEL_USER), simple('tenantId', SENTINEL_WORKSPACE));
  assert.equal(classifyAclTerms(acl, 'userId').ok, false);
});

test('a top-level OR ACL is REJECTED (alternative admission paths are not pure routing)', () => {
  const acl = or(simple('userId', SENTINEL_USER), simple('isPublic', true));
  const e = classifyAclTerms(acl, 'userId');
  assert.equal(e.ok, false);
  assert.match(e.reason ?? '', /OR/i);
});

test('a no-predicate ACL is REJECTED (fail-closed: nothing to route by)', () => {
  const e = classifyAclTerms(undefined, 'userId');
  assert.equal(e.ok, false);
});

// Base-shape branches, exercised with synthetic bases so they are covered before any real onboarding.
test('a cursor (.start) base is REJECTED', () => {
  const base = zql.bookmarks
    .where('workspaceId', PROBE_WORKSPACE)
    .where('isDeleted', false)
    .orderBy('createdAt', 'desc')
    .start({ id: 'x', createdAt: 0 });
  const e = rowLevelEligibilityForBase(base, 'userId');
  assert.equal(e.ok, false);
  assert.match(e.reason ?? '', /cursor|\.start/i);
});

test('a many:1 related base is REJECTED (child shared across owners)', () => {
  // activities.channel is sourceField ['channelId'] (a non-PK FK) → one channel serves many owners.
  const base = zql.activities.where('workspaceId', PROBE_WORKSPACE).related('channel');
  const e = rowLevelEligibilityForBase(base, 'userId');
  assert.equal(e.ok, false);
  assert.match(e.reason ?? '', /1:1-owned|parentField/i);
});

test('a base missing the workspace partition is REJECTED (tenant boundary)', () => {
  const base = zql.bookmarks.where('isDeleted', false);
  const e = rowLevelEligibilityForBase(base, 'userId');
  assert.equal(e.ok, false);
  assert.match(e.reason ?? '', /workspaceId/i);
});

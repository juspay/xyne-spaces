import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose: this is exactly the module consumers
// resolve, so a mismatch between src and the published dist shows up here too.
// Run via `pnpm --filter @xyne/shared test` (builds first).
import {
  isBellCountedActivity,
  countDmShelfMentionRows,
} from '../dist/unread/countPredicates.js';
import { BELL_COUNT_RULES } from '../dist/unread/bellCountRules.js';

/**
 * Parity tests for the unread badge invariant. The same golden fixtures below
 * are what the backend endpoint (activityService.getWorkspaceActivityCounts —
 * a Prisma where-clause translation of BELL_COUNT_RULES) and the dashboard
 * hooks (these shared predicates) must agree on. The backend jest suite
 * (activityService.test.ts) pins the Prisma translation; this suite pins the
 * client predicate. If a fixture changes its expected count here, change the
 * backend query (and its tests) in the same commit.
 */

/** activity row factory */
const act = (overrides = {}) => ({
  actorAction: 'mentioned_user',
  actionSource: 'message',
  classification: 'PENDING',
  isRead: false,
  channelId: 'ch-1',
  isThreadActivity: false,
  ...overrides,
});

const emptyClosed = new Set();

test('bell counts a plain unread mention', () => {
  assert.equal(isBellCountedActivity(act(), emptyClosed), true);
});

test('bell counts ERROR and PENDING classifications', () => {
  assert.equal(isBellCountedActivity(act({ classification: 'ERROR' }), emptyClosed), true);
  assert.equal(isBellCountedActivity(act({ classification: 'PENDING' }), emptyClosed), true);
  assert.equal(isBellCountedActivity(act({ classification: null }), emptyClosed), true);
});

test('bell excludes SKIP', () => {
  assert.equal(isBellCountedActivity(act({ classification: 'SKIP' }), emptyClosed), false);
});

test('bell excludes added_v2 and removed regardless of other fields', () => {
  assert.equal(isBellCountedActivity(act({ actorAction: 'added_v2' }), emptyClosed), false);
  assert.equal(isBellCountedActivity(act({ actorAction: 'removed' }), emptyClosed), false);
});

test('bell excludes missed calls (calls shelf owns them)', () => {
  assert.equal(
    isBellCountedActivity(act({ actorAction: 'missed_call', actionSource: 'call' }), emptyClosed),
    false,
  );
  // non-call actionSource with actorAction missed_call is not a call row, but
  // no such row exists in practice; the predicate matches the server's
  // NOT(actionSource=call AND actorAction=missed_call).
  assert.equal(
    isBellCountedActivity(act({ actorAction: 'missed_call', actionSource: 'message' }), emptyClosed),
    true,
  );
});

test('bell excludes legacy direct_message rows (dm shelf owns them)', () => {
  assert.equal(
    isBellCountedActivity(act({ actorAction: 'direct_message' }), emptyClosed),
    false,
  );
});

test('bell counts thread activities (dock counts DM thread replies)', () => {
  assert.equal(isBellCountedActivity(act({ isThreadActivity: true }), emptyClosed), true);
  // null isThreadActivity (legacy rows) is top-level
  assert.equal(isBellCountedActivity(act({ isThreadActivity: null }), emptyClosed), true);
});

test('bell counts ticket rows with null channelId', () => {
  assert.equal(isBellCountedActivity(act({ channelId: null }), emptyClosed), true);
});

test('bell excludes rows in channels closed for this user (per-user closed state)', () => {
  const closed = new Set(['ch-closed']);
  assert.equal(isBellCountedActivity(act({ channelId: 'ch-closed' }), closed), false);
  assert.equal(isBellCountedActivity(act({ channelId: 'ch-open' }), closed), true);
});

test('dm shelf subtraction counts only top-level GROUP_DM mention message rows', () => {
  const dmChannels = new Set(['gdm-1', 'dm-1', 'other-1']);
  const isGroupDm = id => id === 'gdm-1';

  const rows = [
    act({ channelId: 'gdm-1', actorAction: 'mentioned_user', isThreadActivity: false }),
    act({ channelId: 'gdm-1', actorAction: 'group_mention', isThreadActivity: false }),
    // thread mention — not subtracted (top-level only)
    act({ channelId: 'gdm-1', actorAction: 'mentioned_user', isThreadActivity: true }),
    // legacy-null isThreadActivity — top-level, subtracted
    act({ channelId: 'gdm-1', actorAction: 'group_mention', isThreadActivity: null }),
    // plain DM channel — no subtraction (GROUP_DM only)
    act({ channelId: 'dm-1', actorAction: 'mentioned_user' }),
    // non-DM channel — not part of the dm shelf
    act({ channelId: 'other-1', actorAction: 'mentioned_user' }),
    // not a mention action
    act({ channelId: 'gdm-1', actorAction: 'replied_v2' }),
    // mention via a non-message source — not subtracted
    act({ channelId: 'gdm-1', actorAction: 'mentioned_user', actionSource: 'reaction' }),
  ];

  const byChannel = countDmShelfMentionRows(rows, dmChannels, isGroupDm);
  assert.equal(byChannel.get('gdm-1'), 3);
  assert.equal(byChannel.has('dm-1'), false);
  assert.equal(byChannel.has('other-1'), false);
});

test('dm shelf mention subtraction floors at 0 per channel (rail hook contract)', () => {
  // unreadCount 1 with 4 mention rows -> 0, not negative
  const byChannel = countDmShelfMentionRows(
    [
      act({ channelId: 'gdm-1' }),
      act({ channelId: 'gdm-1' }),
      act({ channelId: 'gdm-1' }),
      act({ channelId: 'gdm-1' }),
    ],
    new Set(['gdm-1']),
    () => true,
  );
  const unreadCount = 1;
  assert.equal(Math.max(0, unreadCount - (byChannel.get('gdm-1') ?? 0)), 0);
});

test('shared rules shape is stable (backend Prisma translation depends on it)', () => {
  assert.deepEqual([...BELL_COUNT_RULES.excludedActorActions], ['added_v2', 'removed']);
  assert.equal(BELL_COUNT_RULES.excludedCalls.actionSource, 'call');
  assert.equal(BELL_COUNT_RULES.excludedCalls.actorAction, 'missed_call');
  assert.deepEqual([...BELL_COUNT_RULES.excludedClassifications], ['SKIP']);
  assert.deepEqual([...BELL_COUNT_RULES.excludedLegacyDirectMessageActions], ['direct_message']);
  assert.equal(BELL_COUNT_RULES.excludeClosedChannels, true);
  assert.deepEqual([...BELL_COUNT_RULES.dmShelf.channelScopes], ['DM', 'GROUP_DM']);
  assert.deepEqual([...BELL_COUNT_RULES.dmShelf.mentionActorActions], [
    'mentioned_user',
    'group_mention',
  ]);
});

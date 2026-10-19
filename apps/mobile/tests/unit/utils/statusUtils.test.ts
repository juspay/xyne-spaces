import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserStatus } from '@xyne/shared';

import {
  isUserDeactivated,
  isUserSelectable,
  isStatusExpired,
  hasActiveCustomStatus,
  hasActiveUserStatus,
  getActiveUserStatusEmoji,
  getActiveUserStatusContent,
} from '@/src/utils/statusUtils';

// Relative offsets keep expiry checks deterministic without stubbing the clock.
const PAST = Date.now() - 60_000;
const FUTURE = Date.now() + 60_000;

// ─── isUserDeactivated / isUserSelectable ───────────────────────────────────

test('isUserDeactivated: true only for INACTIVE status', () => {
  assert.equal(isUserDeactivated({ status: UserStatus.INACTIVE }), true);
  assert.equal(isUserDeactivated({ status: UserStatus.ACTIVE }), false);
});

test('isUserDeactivated: null/undefined users are not deactivated', () => {
  assert.equal(isUserDeactivated(null), false);
  assert.equal(isUserDeactivated(undefined), false);
});

test('isUserSelectable: inverse of deactivation', () => {
  assert.equal(isUserSelectable({ status: UserStatus.INACTIVE }), false);
  assert.equal(isUserSelectable({ status: UserStatus.ACTIVE }), true);
  assert.equal(isUserSelectable(null), true);
});

// ─── isStatusExpired ────────────────────────────────────────────────────────

test('isStatusExpired: falsy expiry is treated as never-expiring', () => {
  assert.equal(isStatusExpired(null), false);
  assert.equal(isStatusExpired(undefined), false);
  assert.equal(isStatusExpired(0), false);
});

test('isStatusExpired: past expiry is expired, future is not', () => {
  assert.equal(isStatusExpired(PAST), true);
  assert.equal(isStatusExpired(FUTURE), false);
});

// ─── hasActiveCustomStatus ──────────────────────────────────────────────────

test('hasActiveCustomStatus: false for null user or empty status', () => {
  assert.equal(hasActiveCustomStatus(null), false);
  assert.equal(hasActiveCustomStatus(undefined), false);
  assert.equal(hasActiveCustomStatus({ statusEmoji: null, statusContent: null }), false);
  assert.equal(hasActiveCustomStatus({}), false);
});

test('hasActiveCustomStatus: emoji-only or content-only counts as active', () => {
  assert.equal(hasActiveCustomStatus({ statusEmoji: '😀' }), true);
  assert.equal(hasActiveCustomStatus({ statusContent: 'In a meeting' }), true);
});

test('hasActiveCustomStatus: expiry gates activity', () => {
  assert.equal(hasActiveCustomStatus({ statusEmoji: '😀', statusExpiryAt: FUTURE }), true);
  assert.equal(hasActiveCustomStatus({ statusEmoji: '😀', statusExpiryAt: PAST }), false);
});

// ─── hasActiveUserStatus ────────────────────────────────────────────────────

test('hasActiveUserStatus: requires an emoji', () => {
  assert.equal(hasActiveUserStatus({ statusEmoji: '😀' }), true);
  assert.equal(hasActiveUserStatus({ statusEmoji: null }), false);
  assert.equal(hasActiveUserStatus({}), false);
  assert.equal(hasActiveUserStatus(undefined), false);
});

test('hasActiveUserStatus: expiry gates activity', () => {
  assert.equal(hasActiveUserStatus({ statusEmoji: '😀', statusExpiryAt: FUTURE }), true);
  assert.equal(hasActiveUserStatus({ statusEmoji: '😀', statusExpiryAt: PAST }), false);
});

// ─── getActiveUserStatusEmoji / getActiveUserStatusContent ──────────────────

test('getActiveUserStatusEmoji: returns emoji only when custom status is active', () => {
  assert.equal(getActiveUserStatusEmoji({ statusEmoji: '🎯' }), '🎯');
  assert.equal(getActiveUserStatusEmoji({ statusEmoji: '🎯', statusExpiryAt: PAST }), undefined);
  // content-only active status still has no emoji to return
  assert.equal(getActiveUserStatusEmoji({ statusContent: 'busy' }), undefined);
  assert.equal(getActiveUserStatusEmoji(undefined), undefined);
});

test('getActiveUserStatusContent: returns content only when custom status is active', () => {
  assert.equal(getActiveUserStatusContent({ statusContent: 'Focusing' }), 'Focusing');
  assert.equal(getActiveUserStatusContent({ statusEmoji: '🎯' }), undefined);
  assert.equal(
    getActiveUserStatusContent({ statusContent: 'Focusing', statusExpiryAt: PAST }),
    undefined,
  );
});

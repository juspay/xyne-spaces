import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveChannelMemberIds } from '../dist/utils/channelMembership.js';

test('membership is unknown until Vespa has responded', () => {
  // Zero hands back [] for the disabled DB fallback — must NOT read as "no members".
  assert.equal(resolveChannelMemberIds(null, [], false), null);
  assert.equal(resolveChannelMemberIds(null, [], true), null);
});

test('non-empty Vespa result is used directly', () => {
  assert.deepEqual(resolveChannelMemberIds(['a', 'b'], [], false), ['a', 'b']);
});

test('empty Vespa result waits for the DB fallback to complete', () => {
  assert.equal(resolveChannelMemberIds([], [], false), null);
  assert.equal(resolveChannelMemberIds([], undefined, true), null);
  assert.deepEqual(resolveChannelMemberIds([], ['a'], true), ['a']);
});

test('a genuinely empty channel resolves to [] once the DB query completes', () => {
  assert.deepEqual(resolveChannelMemberIds([], [], true), []);
});

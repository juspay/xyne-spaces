/** Per-query serve modes (node:test, env-free — the in-code map is the source). */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { modeFor, modesSnapshot, setQueryModesForTests } from './queryModes';

afterEach(() => setQueryModesForTests(null));

test('in-code map: onboarded queries serve, unlisted queries are off', () => {
  setQueryModesForTests(null); // reset to the shipped map
  assert.equal(modeFor('channelLatestMultipleConversationsV4'), 'serve');
  assert.equal(modeFor('getUsersV2'), 'serve');
  assert.equal(modeFor('userDrafts'), 'serve');
  assert.equal(modeFor('somethingNotOnboarded'), 'off', 'absent ⇒ off');
});

test('snapshot carries the map with default=off (unlisted ⇒ off on the client too)', () => {
  const snap = modesSnapshot();
  assert.equal(snap.default, 'off');
  assert.equal(snap.queries['getUsersV2'], 'serve');
  assert.equal(snap.queries['somethingNotOnboarded'], undefined);
});

test('pinned config (test seam): per-query mode wins, absent falls to default', () => {
  setQueryModesForTests({
    default: 'off',
    queries: { getUsersV2: 'shadow', channelLatestMultipleConversationsV4: 'serve' },
  });
  assert.equal(modeFor('getUsersV2'), 'shadow');
  assert.equal(modeFor('channelLatestMultipleConversationsV4'), 'serve');
  assert.equal(modeFor('userDrafts'), 'off', 'not in the pinned map ⇒ default (off)');
});

test('snapshot is a defensive copy', () => {
  setQueryModesForTests({ default: 'off', queries: { a: 'serve' } });
  const snap = modesSnapshot();
  snap.queries.a = 'off';
  (snap as { default: string }).default = 'serve';
  assert.equal(modeFor('a'), 'serve', 'mutating the snapshot must not affect the live config');
  assert.equal(modesSnapshot().default, 'off');
});

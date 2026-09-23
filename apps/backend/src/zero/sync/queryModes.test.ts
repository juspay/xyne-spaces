/** Per-query serve modes (node:test, env-free — the module init degrades to built-in). */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { modeFor, modesSnapshot, setQueryModesForTests } from './queryModes';

afterEach(() => setQueryModesForTests(null));

test('built-in default: shadow for every query (audited-but-not-promoted state)', () => {
  setQueryModesForTests(null);
  assert.equal(modeFor('channelLatestMultipleConversationsV4'), 'shadow');
  assert.equal(modeFor('anything'), 'shadow');
});

test('pinned config: per-query mode wins, default covers the rest', () => {
  setQueryModesForTests({
    default: 'shadow',
    queries: { getUsersV2: 'serve', userDrafts: 'off' },
  });
  assert.equal(modeFor('getUsersV2'), 'serve');
  assert.equal(modeFor('userDrafts'), 'off');
  assert.equal(modeFor('channelLatestMultipleConversationsV4'), 'shadow');
});

test('snapshot is a defensive copy', () => {
  setQueryModesForTests({ default: 'serve', queries: { a: 'off' } });
  const snap = modesSnapshot();
  snap.queries.a = 'serve';
  (snap as { default: string }).default = 'off';
  assert.equal(modeFor('a'), 'off', 'mutating the snapshot must not affect the live config');
  assert.equal(modesSnapshot().default, 'serve');
});

test('default=off expresses a full stop without listing queries', () => {
  setQueryModesForTests({ default: 'off', queries: { channelLatestMultipleConversationsV4: 'serve' } });
  assert.equal(modeFor('getUsersV2'), 'off');
  assert.equal(modeFor('channelLatestMultipleConversationsV4'), 'serve');
});

import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output, like the other tests here. Run via
// `pnpm --filter @xyne/shared test` (builds first).
import {
  canPublishChannelApps,
  supportsChannelApps,
  isValidPublishedAppIdList,
} from '../dist/utils/channel.js';

/**
 * The one rule the backend mutator, the channels ACL and the dashboard all run
 * for who may publish apps to everyone's tabs. A change here changes who can
 * alter what every member of a channel sees, so the whole matrix is pinned.
 */
const ROLES = ['ADMIN', 'MEMBER', null];

const MATRIX = [
  // [scopeType, type, supported, publishers]
  ['DEFAULT', 'DEFAULT', true, ['ADMIN']],
  ['DM', 'DEFAULT', true, ['ADMIN', 'MEMBER']],
  ['GROUP_DM', 'DEFAULT', true, ['ADMIN', 'MEMBER']],
  // Desks are DEFAULT-scoped channels too; the type is what excludes them.
  ['DEFAULT', 'EMAIL', false, []],
  ['DEFAULT', 'SLACK', false, []],
  ['TICKET', 'DEFAULT', false, []],
  ['DOCUMENT', 'DEFAULT', false, []],
];

for (const [scopeType, type, supported, publishers] of MATRIX) {
  test(`supportsChannelApps: ${scopeType}/${type} → ${supported}`, () => {
    assert.equal(supportsChannelApps({ scopeType, type }), supported);
  });

  for (const role of ROLES) {
    // canPublishChannelApps only speaks to scope + role; callers check
    // supportsChannelApps first, so an unsupported channel never gets here.
    if (!supported) continue;
    const expected = publishers.includes(role);
    test(`canPublishChannelApps: ${scopeType} as ${role ?? 'non-participant'} → ${expected}`, () => {
      assert.equal(canPublishChannelApps(scopeType, role), expected);
    });
  }
}

test('canPublishChannelApps: unsupported scopes never allow publishing', () => {
  for (const scopeType of ['TICKET', 'DOCUMENT', null, undefined]) {
    for (const role of ROLES) assert.equal(canPublishChannelApps(scopeType, role), false);
  }
});

test('isValidPublishedAppIdList: accepts what the mutators write', () => {
  assert.equal(isValidPublishedAppIdList(null), true);
  assert.equal(isValidPublishedAppIdList(undefined), true);
  assert.equal(isValidPublishedAppIdList(JSON.stringify(['a', 'b'])), true);
  assert.equal(isValidPublishedAppIdList(JSON.stringify(Array.from({ length: 8 }, (_, i) => `id${i}`))), true);
});

test('isValidPublishedAppIdList: rejects anything larger or malformed', () => {
  assert.equal(isValidPublishedAppIdList('not json'), false);
  assert.equal(isValidPublishedAppIdList('{"a":1}'), false);
  assert.equal(isValidPublishedAppIdList('[]'), false); // empty is stored as null
  assert.equal(isValidPublishedAppIdList(JSON.stringify(Array.from({ length: 9 }, (_, i) => `id${i}`))), false);
  assert.equal(isValidPublishedAppIdList(JSON.stringify(['a', 'a'])), false);
  assert.equal(isValidPublishedAppIdList(JSON.stringify([''])), false);
  assert.equal(isValidPublishedAppIdList(JSON.stringify(['x'.repeat(65)])), false);
  assert.equal(isValidPublishedAppIdList(JSON.stringify([1, 2])), false);
});

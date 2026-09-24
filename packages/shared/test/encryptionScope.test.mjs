import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptionScopeNeedsChannelId,
  isChannelInEncryptionScope,
  isEncryptionScopeEmpty,
} from '../dist/zero/query-validation.js';

test('empty scope: null and [] encrypt nothing and need no channelId', () => {
  for (const scope of [null, []]) {
    assert.equal(isEncryptionScopeEmpty(scope), true);
    assert.equal(encryptionScopeNeedsChannelId(scope), false);
    assert.equal(isChannelInEncryptionScope(scope, 'c1'), false);
  }
});

test('"all" scope: every channel, no channelId needed', () => {
  assert.equal(isEncryptionScopeEmpty('all'), false);
  assert.equal(encryptionScopeNeedsChannelId('all'), false);
  assert.equal(isChannelInEncryptionScope('all', null), true);
});

test('channel list scope: only listed channels, channelId needed', () => {
  const scope = ['c1', 'c2'];
  assert.equal(isEncryptionScopeEmpty(scope), false);
  assert.equal(encryptionScopeNeedsChannelId(scope), true);
  assert.equal(isChannelInEncryptionScope(scope, 'c1'), true);
  assert.equal(isChannelInEncryptionScope(scope, 'c3'), false);
  assert.equal(isChannelInEncryptionScope(scope, null), false);
});

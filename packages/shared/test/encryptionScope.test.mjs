import test from 'node:test';
import assert from 'node:assert/strict';
import { isEncryptionScopeEmpty, isWorkspaceInEncryptionScope } from '../dist/zero/query-validation.js';

test('empty scope: null and [] encrypt nothing', () => {
  for (const scope of [null, []]) {
    assert.equal(isEncryptionScopeEmpty(scope), true);
    assert.equal(isWorkspaceInEncryptionScope(scope, 'w1'), false);
  }
});

test('"all" scope: every workspace', () => {
  assert.equal(isEncryptionScopeEmpty('all'), false);
  assert.equal(isWorkspaceInEncryptionScope('all', 'w1'), true);
});

test('workspace list scope: only listed workspaces', () => {
  const scope = ['w1', 'w2'];
  assert.equal(isEncryptionScopeEmpty(scope), false);
  assert.equal(isWorkspaceInEncryptionScope(scope, 'w1'), true);
  assert.equal(isWorkspaceInEncryptionScope(scope, 'w3'), false);
});

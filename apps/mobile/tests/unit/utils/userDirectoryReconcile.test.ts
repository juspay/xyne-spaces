import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { User } from '@/src/machines/appStateMachine';
import { reconcileUserDirectory } from '@/src/utils/userDirectoryReconcile';

const createUser = (id: string, overrides: Partial<User> = {}): User =>
  ({
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    authProvider: 'GOOGLE',
    providerUserId: `provider-${id}`,
    status: 'ACTIVE',
    userType: 'USER',
    workspaceId: 'workspace-1',
    role: 'MEMBER',
    orgMemberId: `member-${id}`,
    createdAt: 1,
    updatedAt: 1,
    calendarVisibility: 'PUBLIC',
    ...overrides,
  }) as User;

describe('reconcileUserDirectory', () => {
  it('skips an unchanged directory and reuses every object', () => {
    const one = createUser('one');
    const two = createUser('two');
    const current = [one, two];
    const result = reconcileUserDirectory(current, [{ ...one }, { ...two }]);

    assert.equal(result.isNoop, true);
    assert.deepEqual(result.users, current);
    assert.equal(result.users[0], one);
    assert.equal(result.users[1], two);
    assert.equal(result.reused, 2);
    assert.equal(result.changed, 0);
  });

  it('reuses unchanged users while replacing changed users', () => {
    const one = createUser('one');
    const two = createUser('two');
    const current = [one, two];
    const updatedTwo: User = { ...two, displayName: 'Updated Two' };
    const result = reconcileUserDirectory(current, [one, updatedTwo]);

    assert.equal(result.isNoop, false);
    assert.equal(result.users[0], one);
    assert.equal(result.users[1], updatedTwo);
    assert.equal(result.reused, 1);
    assert.equal(result.changed, 1);
  });

  it('handles additions and deletions while following incoming order', () => {
    const two = createUser('two');
    const current = [createUser('one'), two];
    const added = createUser('three');
    const result = reconcileUserDirectory(current, [added, { ...two }]);

    assert.deepEqual(result.users, [added, two]);
    assert.equal(result.users[1], two);
    assert.equal(result.added, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.isNoop, false);
  });

  it('treats a reorder as a real update even when every object is reusable', () => {
    const one = createUser('one');
    const two = createUser('two');
    const current = [one, two];
    const result = reconcileUserDirectory(current, [{ ...two }, { ...one }]);

    assert.equal(result.isNoop, false);
    assert.equal(result.users[0], two);
    assert.equal(result.users[1], one);
    assert.equal(result.reused, 2);
  });

  it('supports an empty directory and does not retain removed users', () => {
    const current = [createUser('one')];
    const result = reconcileUserDirectory(current, []);

    assert.deepEqual(result.users, []);
    assert.equal(result.removed, 1);
    assert.equal(result.isNoop, false);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryLogContextStore } from './InMemoryLogContextStore';

describe('InMemoryLogContextStore', () => {
  it('starts empty and merges identity fields', () => {
    const store = new InMemoryLogContextStore();

    assert.deepEqual(store.snapshot(), {});

    store.set({
      userId: 'user-1',
      email: 'alice@example.com',
    });

    assert.deepEqual(store.snapshot(), {
      userId: 'user-1',
      email: 'alice@example.com',
    });
  });

  it('returns a copy from snapshot()', () => {
    const store = new InMemoryLogContextStore();

    store.set({
      userId: 'user-1',
    });

    const firstSnapshot = store.snapshot();

    store.set({
      userId: 'user-2',
    });

    assert.deepEqual(firstSnapshot, {
      userId: 'user-1',
    });
    assert.deepEqual(store.snapshot(), {
      userId: 'user-2',
    });
  });

  it('unsets selected keys without removing the others', () => {
    const store = new InMemoryLogContextStore();

    store.set({
      userId: 'user-1',
      email: 'alice@example.com',
      workspaceId: 'workspace-1',
    });

    store.unset(['userId', 'email', 'workspaceId']);

    assert.deepEqual(store.snapshot(), {});
  });
});

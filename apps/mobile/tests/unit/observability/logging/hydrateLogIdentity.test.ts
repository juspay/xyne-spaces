import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { logIdentityFromPersistedSession } from '@/src/observability/logging/logIdentityFromPersistedSession';

describe('logIdentityFromPersistedSession', () => {
  const userId = 'user-1';
  const cache = JSON.stringify({
    user_id: 'user-1',
    email: 'ada@example.com',
    workspaceId: 'ws-1',
  });

  it('returns userId, email, and workspaceId from a matching cache', () => {
    assert.deepEqual(logIdentityFromPersistedSession(userId, cache), {
      userId: 'user-1',
      email: 'ada@example.com',
      workspaceId: 'ws-1',
    });
  });

  it('returns null when the user id does not match the cache', () => {
    assert.equal(logIdentityFromPersistedSession('other-user', cache), null);
  });

  it('returns null when email is missing or blank', () => {
    assert.equal(
      logIdentityFromPersistedSession(
        userId,
        JSON.stringify({ user_id: 'user-1', email: '  ', workspaceId: 'ws-1' }),
      ),
      null,
    );
    assert.equal(
      logIdentityFromPersistedSession(userId, JSON.stringify({ user_id: 'user-1' })),
      null,
    );
  });

  it('omits a blank workspaceId and ignores invalid JSON', () => {
    assert.deepEqual(
      logIdentityFromPersistedSession(
        userId,
        JSON.stringify({ user_id: 'user-1', email: 'ada@example.com', workspaceId: '' }),
      ),
      {
        userId: 'user-1',
        email: 'ada@example.com',
      },
    );
    assert.equal(logIdentityFromPersistedSession(userId, '{'), null);
    assert.equal(logIdentityFromPersistedSession(null, cache), null);
  });
});

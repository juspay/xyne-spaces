import test from 'node:test';
import assert from 'node:assert/strict';

import {
  flushQueryCachePersistence,
  queryCacheActor,
  setupQueryCachePersistence,
} from '../dist/machines/queryCacheMachine.js';

const USER = 'user-1';
const SCHEMA = 'v1';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function createMemoryAdapter({ init } = {}) {
  const saved = [];
  return {
    saved,
    init: init ?? (async () => {}),
    isInitialized: () => true,
    close() {},
    dropAllUserDatabases: async () => {},
    saveContextProperty: async key => {
      saved.push(key);
    },
    saveContext: async () => {},
    loadContext: async () => null,
    loadContextProperty: async () => null,
  };
}

/**
 * A user/workspace switch calls setup again. If the previous scope's storage
 * finishes initialising after the new one, it must not take persistence back:
 * otherwise the new session's chat windows are written into the old scope.
 */
test('a superseded setup whose storage finishes late never takes over persistence', async () => {
  let finishOldInit;
  const oldScope = createMemoryAdapter({
    init: () => new Promise(resolve => (finishOldInit = resolve)),
  });
  const newScope = createMemoryAdapter();

  setupQueryCachePersistence(oldScope, USER, SCHEMA);
  setupQueryCachePersistence(newScope, USER, SCHEMA);
  await tick();
  finishOldInit();
  await tick();

  queryCacheActor.send({
    type: 'SET_CONVERSATIONS',
    channelId: 'after-switch',
    conversations: [{ conversationId: 'c1', createdAt: 1 }],
  });
  flushQueryCachePersistence();

  assert.deepEqual(oldScope.saved, []);
  assert.ok(newScope.saved.includes('channelConversations'));
});

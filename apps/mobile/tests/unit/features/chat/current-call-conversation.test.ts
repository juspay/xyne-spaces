import { it } from 'node:test';
import assert from 'node:assert/strict';
import { currentCallConversation } from '../../../../src/utils/currentCallConversation';

it('resolves a joined thread from active calls, including serialized metadata', () => {
  for (const metadata of [
    { conversationId: 'thread' },
    JSON.stringify({ conversationId: 'thread' }),
  ]) {
    assert.equal(
      currentCallConversation({
        externalId: 'call',
        conversationId: null,
        activeCalls: [{ externalId: 'call', callOrigin: 'CONVERSATION', metadata }],
      }),
      'thread',
    );
  }
});
it('never treats an unresolved thread as a channel call', () => {
  assert.equal(
    currentCallConversation({
      externalId: 'call',
      conversationId: null,
      activeCalls: [{ externalId: 'call', callOrigin: 'CONVERSATION', metadata: '{' }],
    }),
    'call',
  );
});
it('uses initiate context until synced and clears it for a channel call', () => {
  assert.equal(
    currentCallConversation({ externalId: 'call', conversationId: 'thread', activeCalls: [] }),
    'thread',
  );
  assert.equal(
    currentCallConversation({
      externalId: 'call',
      conversationId: 'thread',
      activeCalls: [{ externalId: 'call', callOrigin: 'CHANNEL' }],
    }),
    null,
  );
});

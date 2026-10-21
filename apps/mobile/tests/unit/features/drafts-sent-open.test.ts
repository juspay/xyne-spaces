import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveDraftsSentOpenDestination,
  twinDraftOpenMessageId,
} from '@/src/features/drafts-sent/drafts-sent-open';

describe('drafts-sent open destination', () => {
  it('opens a ticket Thread tab when the thread is a ticket conversation', () => {
    assert.deepEqual(
      resolveDraftsSentOpenDestination(
        {
          channelId: 'ch-1',
          conversationId: 'thread-9',
          isThreadReply: true,
        },
        'ticket-4',
      ),
      {
        kind: 'ticket',
        ticketId: 'ticket-4',
        channelId: 'ch-1',
        threadId: 'thread-9',
      },
    );
  });

  it('stays on chat for channel drafts, DMs, and threads without a ticket', () => {
    assert.deepEqual(
      resolveDraftsSentOpenDestination(
        { channelId: 'ch-1', conversationId: null, isThreadReply: false },
        'ticket-4',
      ),
      { kind: 'chat' },
    );
    assert.deepEqual(
      resolveDraftsSentOpenDestination(
        { channelId: 'ch-1', conversationId: 'thread-9', isThreadReply: true },
        null,
      ),
      { kind: 'chat' },
    );
  });

  it('does not use the Twin conversation id as a message highlight', () => {
    assert.equal(
      twinDraftOpenMessageId({
        conversationId: 'thread-9',
        sourceMessageId: 'msg-root',
      }),
      'msg-root',
    );
    assert.equal(
      twinDraftOpenMessageId({
        conversationId: 'thread-9',
        sourceMessageId: 'thread-9',
      }),
      undefined,
    );
    assert.equal(twinDraftOpenMessageId({ conversationId: 'thread-9' }), undefined);
  });
});

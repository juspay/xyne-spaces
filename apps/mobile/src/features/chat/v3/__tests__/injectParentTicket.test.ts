import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { injectParentTicket } from '../data/injectParentTicket';
import type { Conversation } from '../data/normalizeConversationWindow';
import { threadReplyChrome } from '../model/threadReplyChrome';
import type { ChatRow } from '../model/chatRow.types';

const conversation = (id: string): Conversation =>
  ({ conversationId: id, channelId: 'ch-1' }) as Conversation;

describe('injectParentTicket', (): void => {
  it('writes ticket_md onto the first thread row only', (): void => {
    const next = injectParentTicket(
      [conversation('root'), conversation('reply')],
      '<ticket>md</ticket>',
      'T-1',
    );
    assert.equal((next[0] as Record<string, unknown>)['ticket_md'], '<ticket>md</ticket>');
    assert.equal((next[0] as Record<string, unknown>)['ticketId'], 'T-1');
    assert.equal((next[1] as Record<string, unknown>)['ticket_md'], undefined);
  });

  it('is a no-op when the thread is empty or no parent ticket is provided', (): void => {
    const rows = [conversation('root')];
    assert.deepEqual(injectParentTicket([], 'md', 'T-1'), []);
    assert.equal(injectParentTicket(rows, null, null), rows);
  });
});

describe('threadReplyChrome', (): void => {
  const message = (id: string): ChatRow =>
    ({ type: 'message', id, model: { conversationId: id } }) as ChatRow;

  it('counts replies after the first message row on a thread', (): void => {
    const chrome = threadReplyChrome(
      [
        { type: 'date', id: 'd', date: 1 } as ChatRow,
        message('root'),
        message('r1'),
        message('r2'),
      ],
      true,
    );
    assert.equal(chrome.rootId, 'root');
    assert.equal(chrome.count, 2);
  });

  it('does not paint a divider on channel surfaces', (): void => {
    const chrome = threadReplyChrome([message('root'), message('r1')], false);
    assert.equal(chrome.rootId, null);
    assert.equal(chrome.count, 0);
  });

  it('uses the larger of loaded replies and the parent replyPreview count', (): void => {
    const chrome = threadReplyChrome(
      [
        {
          type: 'message',
          id: 'root',
          model: { conversationId: 'root', replyPreview: { count: 4 } },
        } as ChatRow,
        { type: 'message', id: 'r1', model: { conversationId: 'r1' } } as ChatRow,
      ],
      true,
    );
    assert.equal(chrome.rootId, 'root');
    assert.equal(chrome.count, 4);
  });
});

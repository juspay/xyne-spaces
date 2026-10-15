import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ConversationSummary,
  StoredMessage,
} from '@/src/features/xyne-ai/api/xyneAIConversations';
import { answerText, turnsFromMessages } from '@/src/features/xyne-ai/model/assistantTurn';
import { groupConversations } from '@/src/features/xyne-ai/model/conversationGroups';

const user = (id: string, extra: Partial<StoredMessage> = {}): StoredMessage => ({
  id,
  role: 'user',
  content: `question ${id}`,
  createdAt: '2026-01-01T10:00:00Z',
  ...extra,
});
const assistant = (
  id: string,
  content: string,
  extra: Partial<StoredMessage> = {},
): StoredMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: '2026-01-01T10:00:05Z',
  ...extra,
});

describe('turnsFromMessages', () => {
  it('pairs each question with its answer, tools, follow-ups and saved rating', () => {
    const attachedContext = [{ type: 'channel', id: 'c1', title: 'general' }];
    const [turn] = turnsFromMessages({
      data: [
        user('u1', { attachedContext }),
        assistant('a1', 'Hello', { followUpSuggestions: ['More?'], durationMs: 4000 }),
      ],
      invocationsByMsgId: {
        a1: [
          { toolName: 'search', toolCallId: 't1', args: {}, status: 'completed', durationMs: 5 },
        ],
      },
      ratingByMsgId: { a1: { rating: 'up' } },
    });
    assert.equal(turn?.query, 'question u1');
    assert.deepEqual(turn?.context, attachedContext);
    assert.equal(turn?.reply.status, 'complete');
    assert.equal(answerText(turn!.reply), 'Hello');
    assert.deepEqual(
      turn?.reply.parts.map(part => part.type),
      ['tool', 'text'],
    );
    assert.equal(turn?.reply.messageId, 'a1');
    assert.equal(turn?.reply.userMessageId, 'u1');
    assert.deepEqual(turn?.reply.followUps, ['More?']);
    assert.equal(turn?.reply.durationMs, 4000);
    assert.equal(turn?.reply.rating, 'up');
  });

  it('shows the latest of several answers and stops an unanswered question', () => {
    const turns = turnsFromMessages({
      data: [user('u1'), assistant('a1', 'old'), assistant('a2', 'new'), user('u2')],
    });
    assert.equal(turns.length, 2);
    assert.equal(answerText(turns[0]!.reply), 'new');
    assert.equal(turns[1]?.reply.status, 'stopped');
  });

  it('prefers the stored parts over the plain content', () => {
    const [turn] = turnsFromMessages({
      data: [
        user('u1'),
        assistant('a1', 'ignored', {
          parts: [{ type: 'text', id: 'p1', text: 'from parts' }],
        }),
      ],
    });
    assert.equal(answerText(turn!.reply), 'from parts');
  });
});

describe('groupConversations', () => {
  const at = (rowId: string, lastMessageAt: string, pinned = false): ConversationSummary => ({
    rowId,
    conversationId: rowId,
    title: rowId,
    lastMessageAt,
    agentSlug: 'ask-ai',
    pinned,
  });

  it('puts pinned first, then buckets by day and drops empty groups', () => {
    const now = new Date('2026-03-10T12:00:00');
    const groups = groupConversations(
      [
        at('old', '2026-01-01T09:00:00'),
        at('week', '2026-03-05T09:00:00'),
        at('yesterday', '2026-03-09T23:00:00'),
        at('today', '2026-03-10T08:00:00'),
        at('pinned', '2025-01-01T09:00:00', true),
      ],
      now,
    );
    assert.deepEqual(
      groups.map(group => [group.label, group.conversations.map(c => c.rowId)]),
      [
        ['Pinned', ['pinned']],
        ['Today', ['today']],
        ['Yesterday', ['yesterday']],
        ['Previous 7 days', ['week']],
        ['Older', ['old']],
      ],
    );
  });
});

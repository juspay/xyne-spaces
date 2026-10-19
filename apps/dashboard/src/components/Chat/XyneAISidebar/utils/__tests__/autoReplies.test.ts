import { describe, expect, it } from 'vitest';
import type { ConversationHistory } from '../XyneAITypes';
import { isAutoReplyConversation, splitAutoReplies } from '../XyneAIUtils';

const conversation = (
  sessionId: string,
  agentSlug: string,
  agentSlugs?: string[],
): ConversationHistory => ({
  id: `${sessionId}:${agentSlug}`,
  channelId: '',
  sessionId,
  title: sessionId,
  messages: [],
  createdAt: new Date(0),
  lastUpdated: new Date(0),
  agentSlug,
  ...(agentSlugs ? { agentSlugs } : {}),
});

describe('isAutoReplyConversation', () => {
  it('flags a Digital Twin thread', () => {
    expect(isAutoReplyConversation(conversation('thread-1', 'digital-twin'))).toBe(true);
  });

  it('keeps a direct chat with the Digital Twin as the user own chat', () => {
    expect(isAutoReplyConversation(conversation('chat-1', 'digital-twin'))).toBe(false);
  });

  it('keeps a thread with any other agent as the user own chat', () => {
    expect(isAutoReplyConversation(conversation('thread-2', 'ask-ai'))).toBe(false);
  });

  it('reads every agent on the row, not only the latest', () => {
    expect(
      isAutoReplyConversation(conversation('thread-3', 'ask-ai', ['digital-twin', 'ask-ai'])),
    ).toBe(true);
  });
});

describe('splitAutoReplies', () => {
  it('splits rows and keeps their order', () => {
    const rows = [
      conversation('thread-1', 'digital-twin'),
      conversation('chat-1', 'ask-ai'),
      conversation('thread-2', 'digital-twin'),
      conversation('chat-2', 'digital-twin'),
    ];

    const { own, autoReplies } = splitAutoReplies(rows);

    expect(own.map(row => row.sessionId)).toEqual(['chat-1', 'chat-2']);
    expect(autoReplies.map(row => row.sessionId)).toEqual(['thread-1', 'thread-2']);
  });
});

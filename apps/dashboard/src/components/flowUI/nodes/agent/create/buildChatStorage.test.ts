import { describe, expect, it } from 'vitest';
import type { Message } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import { DRAFT_MAX_AGE_MS } from './agentCreateDraftStorage';
import {
  BUILD_CHAT_MAX_MESSAGES,
  parseStoredBuildChat,
  serializeBuildChat,
  type BuildChatThread,
} from './buildChatStorage';

const at = new Date('2026-09-30T10:00:00Z');
const msg = (
  id: string,
  type: Message['type'],
  content: string,
  over: Partial<Message> = {},
): Message => ({
  id,
  type,
  content,
  timestamp: at,
  ...over,
});

const thread: BuildChatThread = {
  messages: [
    msg('u1', 'user', "I want an agent to help with our team's standups"),
    msg('b1', 'bot', 'What should this standup agent do for your team?'),
    msg('u2', 'user', 'Job: Track blockers.'),
    msg('b2', 'bot', 'Drafted a read-only Standup Digest agent.'),
  ],
  extras: {
    b1: {
      activities: [],
      suggestions: [],
      question: {
        id: 'q1',
        questions: [
          {
            id: 'job',
            label: 'Job',
            question: 'What should it do?',
            type: 'multiple_choice',
            options: [{ label: 'Track blockers' }],
          },
        ],
        phase: 'answered',
        answers: {},
        notes: {},
      },
    },
    gone: { activities: [], suggestions: [] },
  },
  fromCard: ['u2', 'gone'],
};

describe('build chat storage', () => {
  it('keeps the connect cards a reply carries, so they survive an OAuth round trip', () => {
    const now = at.getTime() + 1000;
    const withCards: BuildChatThread = {
      ...thread,
      extras: {
        ...thread.extras,
        b2: { activities: [], suggestions: [], connect: ['github', 'slack'] },
      },
    };
    const restored = parseStoredBuildChat(serializeBuildChat(withCards, now), now);
    expect(restored?.extras['b2']?.connect).toEqual(['github', 'slack']);
    expect(restored?.extras['b1']?.connect).toBeUndefined();
  });

  it('brings the conversation back, question cards and all', () => {
    const now = at.getTime() + 1000;
    const restored = parseStoredBuildChat(serializeBuildChat(thread, now), now);
    expect(restored?.messages.map(m => [m.id, m.type, m.content])).toEqual(
      thread.messages.map(m => [m.id, m.type, m.content]),
    );
    expect(restored?.messages[0]?.timestamp.getTime()).toBe(at.getTime());
    expect(restored?.extras['b1']?.question?.phase).toBe('answered');
    // Extras and card turns for messages that are not kept drop out.
    expect(Object.keys(restored?.extras ?? {})).toEqual(['b1']);
    expect(restored?.fromCard).toEqual(['u2']);
  });

  it('marks a reply that was still streaming as cut off', () => {
    const live = {
      ...thread,
      messages: [msg('u1', 'user', 'hi'), msg('b1', 'bot', 'Drafting', { isStreaming: true })],
    };
    const restored = parseStoredBuildChat(serializeBuildChat(live, at.getTime()), at.getTime());
    expect(restored?.messages[1]?.isAborted).toBe(true);
    expect(restored?.messages[1]?.isStreaming).toBeUndefined();
  });

  it('keeps only the latest messages', () => {
    const many = Array.from({ length: BUILD_CHAT_MAX_MESSAGES + 5 }, (_, i) =>
      msg(`m${i}`, 'user', `${i}`),
    );
    const restored = parseStoredBuildChat(
      serializeBuildChat({ messages: many, extras: {}, fromCard: [] }, at.getTime()),
      at.getTime(),
    );
    expect(restored?.messages).toHaveLength(BUILD_CHAT_MAX_MESSAGES);
    expect(restored?.messages[0]?.id).toBe('m5');
  });

  it('forgets a chat as old as a stale draft, and ignores junk', () => {
    const raw = serializeBuildChat(thread, at.getTime());
    expect(parseStoredBuildChat(raw, at.getTime() + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseStoredBuildChat('{not json', at.getTime())).toBeNull();
    expect(
      parseStoredBuildChat(
        JSON.stringify({ v: 1, savedAt: at.getTime(), messages: [{ id: 1 }] }),
        at.getTime(),
      ),
    ).toBeNull();
  });
});

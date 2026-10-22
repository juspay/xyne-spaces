import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import type {
  LiveFrame,
  PendingAction,
  XyneAIEvent,
} from '@/src/features/xyne-ai/api/xyneAIEvents';
import type { StoredConversation } from '@/src/features/xyne-ai/api/xyneAIConversations';
import type { XyneAIStreamRequest } from '@/src/features/xyne-ai/api/xyneAIRequest';
import { answerText, turnsFromMessages } from '@/src/features/xyne-ai/model/assistantTurn';
import { useXyneAIChat } from '@/src/features/xyne-ai/hooks/useXyneAIChat';
import { EventStreamHttpError } from '@/src/services/http/eventStream';

type Stream = {
  request: XyneAIStreamRequest;
  signal: AbortSignal;
  emit: (event: XyneAIEvent) => void;
  close: () => void;
  fail: (error: unknown) => void;
};

type LiveStream = {
  emit: (frame: LiveFrame) => void;
  close: () => void;
  signal: AbortSignal;
};

const mockStreams: Stream[] = [];
const mockLive: LiveStream[] = [];
const mockRespond = jest.fn<() => Promise<unknown>>();
const mockFetchMessages = jest.fn<() => Promise<unknown>>();
const mockCancel = jest.fn<(traceId: string) => Promise<unknown>>();
const NO_OPTIONS = {};
let mockAppStateListener: (state: string) => void = () => undefined;
const mockAppStateChange = (state: string): void => mockAppStateListener(state);

jest.mock('@/src/utils/logger', () => ({ Event: {}, logger: { error: jest.fn() } }));

jest.mock('@/src/features/xyne-ai/api/xyneAIStream', () => ({
  cancelXyneAI: (traceId: string): Promise<unknown> => mockCancel(traceId),
  respondToPendingAction: (): Promise<unknown> => mockRespond(),
  streamLiveConversation: (
    _: unknown,
    { signal, onFrame }: { signal: AbortSignal; onFrame: (frame: LiveFrame) => void },
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const { RequestAbortedError: AbortedError } = jest.requireActual<
        typeof import('@/src/services/http/request-errors')
      >('@/src/services/http/request-errors');
      signal.addEventListener('abort', () => reject(new AbortedError()));
      mockLive.push({ emit: onFrame, close: resolve, signal });
    }),
  streamXyneAI: (
    request: XyneAIStreamRequest,
    { signal, onEvent }: { signal: AbortSignal; onEvent: (event: XyneAIEvent) => void },
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const { RequestAbortedError: AbortedError } = jest.requireActual<
        typeof import('@/src/services/http/request-errors')
      >('@/src/services/http/request-errors');
      signal.addEventListener('abort', () => reject(new AbortedError()));
      mockStreams.push({ request, signal, emit: onEvent, close: resolve, fail: reject });
    }),
}));

jest.mock('@/src/features/xyne-ai/api/xyneAIConversations', () => ({
  fetchConversationMessages: (): Promise<unknown> => mockFetchMessages(),
}));

const lastLive = (): LiveStream => {
  const stream = mockLive.at(-1);
  if (!stream) throw new Error('no live stream attached');
  return stream;
};

const lastStream = (): Stream => {
  const stream = mockStreams.at(-1);
  if (!stream) throw new Error('no stream started');
  return stream;
};

const complete = (content: string, followUps: string[] = [], messageId = 'm1'): XyneAIEvent => ({
  type: 'complete',
  content,
  messageId,
  userMessageId: 'u1',
  followUps,
  durationMs: undefined,
  parts: undefined,
  userTags: undefined,
  attachments: [],
  pendingActions: [],
});

const approval: PendingAction = {
  id: 'p1',
  serverType: 'srv',
  tool: 'srv__send',
  params: {},
  signature: 'sig',
  resolution: undefined,
};

const completeWithApproval = (): XyneAIEvent => ({
  ...(complete('Needs approval') as Extract<XyneAIEvent, { type: 'complete' }>),
  pendingActions: [approval],
});

const text = (delta: string): XyneAIEvent => ({ type: 'text', delta, partId: undefined });

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    mockAppStateListener = listener as (state: string) => void;
    return { remove: (): void => undefined };
  });
  mockStreams.length = 0;
  mockLive.length = 0;
  mockRespond.mockReset().mockResolvedValue(undefined);
  mockFetchMessages.mockReset();
  mockCancel.mockReset().mockResolvedValue(undefined);
});

describe('useXyneAIChat', () => {
  it('streams an answer into the turn and settles it', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));

    act(() => result.current.send('  Hello  '));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.turns[0]?.query).toBe('Hello');
    expect(lastStream().request).toEqual({
      query: 'Hello',
      sessionId: '',
      attachedContext: [],
      attachments: [],
    });

    act(() => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(text('Hi '));
      lastStream().emit(text('there'));
    });
    await waitFor(() => expect(answerText(result.current.turns[0]!.reply)).toBe('Hi there'));
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      lastStream().emit(complete('Hi there!', ['More?']));
      lastStream().close();
    });
    await waitFor(() => expect(result.current.turns[0]?.reply.status).toBe('complete'));
    expect(answerText(result.current.turns[0]!.reply)).toBe('Hi there!');
    expect(result.current.turns[0]?.reply.followUps).toEqual(['More?']);
    expect(result.current.isStreaming).toBe(false);
  });

  it('continues the server session on the next message', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    await act(async () => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(complete('First'));
      lastStream().close();
    });

    act(() => result.current.send('Two'));
    expect(lastStream().request).toEqual({
      query: 'Two',
      sessionId: 's1',
      attachedContext: [],
      attachments: [],
      parentMessageId: 'm1',
    });
  });

  it('sends an edited question as a new version beside the old one', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    await act(async () => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(complete('First'));
      lastStream().close();
    });
    const original = result.current.turns[0]!;

    act(() => result.current.edit(original, 'One, reworded'));
    expect(lastStream().request).toEqual({
      query: 'One, reworded',
      sessionId: 's1',
      attachedContext: [],
      attachments: [],
      isEditUserMessage: true,
      editedUserMessageId: 'u1',
    });
    expect(result.current.turns.map(turn => turn.query)).toEqual(['One, reworded']);
    expect(result.current.versionOf(result.current.turns[0]!)).toEqual({ index: 1, total: 2 });

    act(() => result.current.switchVersion(result.current.turns[0]!, -1));
    expect(result.current.turns.map(turn => turn.query)).toEqual(['One']);
  });

  it('branches an edit of a later question from the answer before it', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    await act(async () => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(complete('First'));
      lastStream().close();
    });
    act(() => result.current.send('Two'));
    await act(async () => lastStream().emit(complete('Second', [], 'm2')));

    act(() => result.current.edit(result.current.turns[1]!, 'Two again'));
    expect(lastStream().request).toMatchObject({
      parentMessageId: 'm1',
      parentAssistantMessageId: 'm1',
      isEditUserMessage: true,
    });
    expect(result.current.turns.map(turn => turn.query)).toEqual(['One', 'Two again']);
  });

  it('marks a stopped answer and keeps its partial text', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('Long question'));
    act(() => lastStream().emit(text('Partial')));

    await act(async () => result.current.stop());
    await waitFor(() => expect(result.current.turns[0]?.reply.status).toBe('stopped'));
    expect(answerText(result.current.turns[0]!.reply)).toBe('Partial');
    expect(result.current.isStreaming).toBe(false);
  });

  it('cancels the server run before aborting a stopped answer', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('Long question'));
    act(() => lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' }));

    await act(async () => result.current.stop());
    expect(mockCancel).toHaveBeenCalledWith('t1');
  });

  it('leaves the server run going when unmounted', () => {
    const { result, unmount } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('Long question'));
    act(() => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(text('Partial'));
    });

    unmount();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(lastStream().signal.aborted).toBe(true);
  });

  it('only aborts locally when the run has no trace id yet', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('Long question'));

    await act(async () => result.current.stop());
    expect(mockCancel).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.turns[0]?.reply.status).toBe('stopped'));
  });

  it('does not cancel a run that already completed', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    await act(async () => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(complete('Done'));
    });

    act(() => result.current.stop());
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('sends the selected agent and model with each message', () => {
    const options = { agentSlug: 'research', model: 'm1', modelProvider: 'litellm' };
    const { result } = renderHook(() => useXyneAIChat(options));
    act(() => result.current.send('Hi'));
    expect(lastStream().request).toEqual({
      ...options,
      query: 'Hi',
      sessionId: '',
      attachedContext: [],
      attachments: [],
    });
  });

  it('regenerates the latest answer as a branch of the same question', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    await act(async () => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(complete('First'));
      lastStream().close();
    });

    act(() => result.current.regenerate());
    expect(lastStream().request).toEqual({
      query: 'One',
      sessionId: 's1',
      attachedContext: [],
      attachments: [],
      parentMessageId: 'u1',
      isRegenerate: true,
    });
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.isStreaming).toBe(true);
  });

  it('records the HTTP status when the request fails', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('Hi'));
    await act(async () => lastStream().fail(new EventStreamHttpError(429, '')));
    await waitFor(() => expect(result.current.turns[0]?.reply.status).toBe('error'));
    expect(result.current.turns[0]?.reply.error?.title).toBe('Rate limit reached');
  });

  it('keeps a held-open stream from touching the next turn', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    const first = lastStream();
    await act(async () => {
      first.emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      first.emit(complete('First'));
    });
    await waitFor(() => expect(result.current.turns[0]?.reply.status).toBe('complete'));

    // The server holds the stream open for follow-ups; asking again aborts it.
    act(() => result.current.send('Two'));
    act(() => first.emit(text('late')));
    await act(async () => lastStream().emit(text('Second')));

    await waitFor(() => expect(answerText(result.current.turns[1]!.reply)).toBe('Second'));
    expect(answerText(result.current.turns[0]!.reply)).toBe('First');
    expect(result.current.turns[0]?.reply.status).toBe('complete');
  });

  it('clears the conversation and starts a new session', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    await act(async () => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().close();
    });

    act(() => result.current.reset());
    expect(result.current.turns).toEqual([]);
    act(() => result.current.send('Fresh'));
    expect(lastStream().request.sessionId).toBe('');
  });
  it('retries a question the server never acknowledged as a new message', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
    act(() => result.current.send('One'));
    await act(async () => {
      lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
      lastStream().emit(complete('First'));
      lastStream().close();
    });
    act(() => result.current.send('Two'));
    await act(async () => {
      lastStream().emit({ type: 'error', message: 'boom', httpStatus: undefined });
      lastStream().close();
    });

    act(() => result.current.regenerate());
    expect(lastStream().request).toEqual({
      query: 'Two',
      sessionId: 's1',
      attachedContext: [],
      attachments: [],
      parentMessageId: 'm1',
    });
  });

  describe('pending actions', () => {
    async function pausedChat(): Promise<
      ReturnType<typeof renderHook<ReturnType<typeof useXyneAIChat>, unknown>>
    > {
      const chat = renderHook(() => useXyneAIChat({ agentSlug: 'helper' }));
      act(() => chat.result.current.send('Do it'));
      await act(async () => {
        lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
        lastStream().emit(completeWithApproval());
        lastStream().close();
      });
      await waitFor(() => expect(chat.result.current.turns[0]?.reply.status).toBe('complete'));
      return chat;
    }

    it('marks the action resolved and leaves the turn alone when no run resumes', async () => {
      const { result } = await pausedChat();
      const turnId = result.current.turns[0]!.id;

      await act(async () => {
        const response = result.current.respondToAction(turnId, approval, true);
        await response;
        lastLive().emit({ events: [], ended: true });
      });

      expect(mockRespond).toHaveBeenCalledTimes(1);
      expect(result.current.turns[0]?.reply.pendingActions[0]?.resolution).toBe('approved');
      expect(result.current.turns[0]?.reply.status).toBe('complete');
      expect(mockFetchMessages).not.toHaveBeenCalled();
    });

    it('shows the resumed run, then reloads the stored conversation', async () => {
      const { result } = await pausedChat();
      const turnId = result.current.turns[0]!.id;
      mockFetchMessages.mockResolvedValue({
        data: [
          { id: 'u1', role: 'user', content: 'Do it', createdAt: '2026-01-01T10:00:00Z' },
          { id: 'a2', role: 'assistant', content: 'Sent', createdAt: '2026-01-01T10:00:09Z' },
        ],
      });

      await act(async () => {
        await result.current.respondToAction(turnId, approval, false);
        lastLive().emit({ events: [text('Sen')], ended: false });
      });
      expect(result.current.turns[0]?.reply.pendingActions[0]?.resolution).toBe('declined');
      await waitFor(() => expect(result.current.isStreaming).toBe(true));

      await act(async () => lastLive().emit({ events: [], ended: true }));
      await waitFor(() => expect(answerText(result.current.turns[0]!.reply)).toBe('Sent'));
      expect(result.current.turns[0]?.reply.messageId).toBe('a2');
      expect(result.current.isStreaming).toBe(false);
    });

    it('does not resolve the action when sending the decision fails', async () => {
      const { result } = await pausedChat();
      mockRespond.mockRejectedValue(new Error('offline'));

      await act(async () => {
        await expect(
          result.current.respondToAction(result.current.turns[0]!.id, approval, true),
        ).rejects.toThrow('offline');
      });
      expect(result.current.turns[0]?.reply.pendingActions[0]?.resolution).toBeUndefined();
      expect(mockLive).toHaveLength(0);
    });

    it('stops following the run on Stop and on a new chat', async () => {
      const { result } = await pausedChat();
      await act(async () => {
        await result.current.respondToAction(result.current.turns[0]!.id, approval, true);
        lastLive().emit({ events: [text('Working')], ended: false });
      });
      await waitFor(() => expect(result.current.isStreaming).toBe(true));

      act(() => result.current.stop());
      expect(lastLive().signal.aborted).toBe(true);
      await waitFor(() => expect(result.current.turns[0]?.reply.status).toBe('stopped'));
      expect(mockFetchMessages).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.respondToAction(result.current.turns[0]!.id, approval, true);
      });
      act(() => result.current.reset());
      expect(lastLive().signal.aborted).toBe(true);
    });
  });

  describe('reattaching to a run', () => {
    const storedQuestion: StoredConversation = {
      data: [{ id: 'u1', role: 'user', content: 'Long task', createdAt: '2026-01-01T10:00:00Z' }],
    };
    const storedAnswered: StoredConversation = {
      data: [
        ...storedQuestion.data,
        { id: 'a1', role: 'assistant', content: 'Done', createdAt: '2026-01-01T10:00:09Z' },
      ],
    };

    it('streams a run still live into the opened conversation, then reloads it', async () => {
      const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
      mockFetchMessages.mockResolvedValue(storedAnswered);

      act(() => result.current.open(turnsFromMessages(storedQuestion), 's1', true));
      expect(result.current.turns[0]?.reply.status).toBe('streaming');

      await act(async () => lastLive().emit({ events: [text('Wor')], ended: false }));
      await waitFor(() => expect(answerText(result.current.turns[0]!.reply)).toBe('Wor'));
      expect(result.current.isStreaming).toBe(true);

      await act(async () => lastLive().emit({ events: [], ended: true }));
      await waitFor(() => expect(answerText(result.current.turns[0]!.reply)).toBe('Done'));
      expect(result.current.isStreaming).toBe(false);
    });

    it('leaves the stored conversation alone when no run is live', async () => {
      const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));

      await act(async () => {
        result.current.open(turnsFromMessages(storedQuestion), 's1', true);
        lastLive().emit({ events: [], ended: true, isSnapshot: true });
      });

      expect(result.current.turns[0]?.reply.status).toBe('stopped');
      expect(mockFetchMessages).not.toHaveBeenCalled();
    });

    it('re-reads a cut-off chat and reattaches when the app returns to the foreground', async () => {
      const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
      act(() => result.current.send('Long task'));
      await act(async () => {
        lastStream().emit({ type: 'start', sessionId: 's1', traceId: 't1' });
        lastStream().fail(new Error('network lost'));
      });
      await waitFor(() => expect(result.current.turns[0]?.reply.status).toBe('error'));
      mockFetchMessages.mockResolvedValue(storedQuestion);

      await act(async () => mockAppStateChange('active'));
      await waitFor(() => expect(mockLive).toHaveLength(1));
      expect(mockFetchMessages).toHaveBeenCalledTimes(1);
      expect(mockCancel).not.toHaveBeenCalled();
      expect(result.current.turns[0]?.reply.status).toBe('streaming');

      await act(async () => lastLive().emit({ events: [], ended: true, isSnapshot: true }));
      expect(result.current.turns[0]?.reply.status).toBe('stopped');
    });

    it('does nothing on return when the last answer finished', async () => {
      const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));
      act(() => result.current.open(turnsFromMessages(storedAnswered), 's1', true));
      mockLive.length = 0;

      await act(async () => mockAppStateChange('active'));
      expect(mockFetchMessages).not.toHaveBeenCalled();
      expect(mockLive).toHaveLength(0);
    });
  });
});

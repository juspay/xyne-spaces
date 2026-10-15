import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { XyneAIEvent } from '@/src/features/xyne-ai/api/xyneAIEvents';
import type { XyneAIStreamRequest } from '@/src/features/xyne-ai/api/xyneAIRequest';
import { answerText } from '@/src/features/xyne-ai/model/assistantTurn';
import { useXyneAIChat } from '@/src/features/xyne-ai/hooks/useXyneAIChat';
import { EventStreamHttpError } from '@/src/services/http/eventStream';

type Stream = {
  request: XyneAIStreamRequest;
  emit: (event: XyneAIEvent) => void;
  close: () => void;
  fail: (error: unknown) => void;
};

const mockStreams: Stream[] = [];
const mockCancel = jest.fn<(traceId: string) => Promise<unknown>>();
const NO_OPTIONS = {};

jest.mock('@/src/utils/logger', () => ({ Event: {}, logger: { error: jest.fn() } }));

jest.mock('@/src/features/xyne-ai/api/xyneAIStream', () => ({
  cancelXyneAI: (traceId: string): Promise<unknown> => mockCancel(traceId),
  streamXyneAI: (
    request: XyneAIStreamRequest,
    { signal, onEvent }: { signal: AbortSignal; onEvent: (event: XyneAIEvent) => void },
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const { RequestAbortedError: AbortedError } = jest.requireActual<
        typeof import('@/src/services/http/request-errors')
      >('@/src/services/http/request-errors');
      signal.addEventListener('abort', () => reject(new AbortedError()));
      mockStreams.push({ request, emit: onEvent, close: resolve, fail: reject });
    }),
}));

const lastStream = (): Stream => {
  const stream = mockStreams.at(-1);
  if (!stream) throw new Error('no stream started');
  return stream;
};

const complete = (content: string, followUps: string[] = []): XyneAIEvent => ({
  type: 'complete',
  content,
  messageId: 'm1',
  userMessageId: 'u1',
  followUps,
  durationMs: undefined,
  parts: undefined,
});

const text = (delta: string): XyneAIEvent => ({ type: 'text', delta, partId: undefined });

beforeEach(() => {
  mockStreams.length = 0;
  mockCancel.mockReset().mockResolvedValue(undefined);
});

describe('useXyneAIChat', () => {
  it('streams an answer into the turn and settles it', async () => {
    const { result } = renderHook(() => useXyneAIChat(NO_OPTIONS));

    act(() => result.current.send('  Hello  '));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.turns[0]?.query).toBe('Hello');
    expect(lastStream().request).toEqual({ query: 'Hello', sessionId: '', attachedContext: [] });

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
    expect(lastStream().request).toEqual({ query: 'Two', sessionId: 's1', attachedContext: [] });
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
    await act(async () => first.emit(complete('First')));
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
});

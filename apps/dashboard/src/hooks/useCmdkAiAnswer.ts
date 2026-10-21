import { useCallback, useEffect, useRef, useState } from 'react';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import type { Message, ToolInvocation } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { buildXyneAIStreamThreadId } from '../utils/xyneAIStreamThreadId';

export type CmdkAiAnswerStatus = 'idle' | 'streaming' | 'completed' | 'error';

export interface CmdkAiAnswer {
  status: CmdkAiAnswerStatus;
  /** The query the current answer is for. */
  askedQuery: string | null;
  /** Answer markdown so far (grows while streaming). */
  content: string;
  /** Tool calls behind the answer; their citations back the inline `[clf-…]` markers. */
  toolInvocations: ToolInvocation[];
  error: string | null;
}

/** One-turn agent claw-auth provisions for cmd+K; its runs stay out of Ask AI history. */
const CMDK_ANSWER_AGENT = 'cmdk-answer';

const IDLE: CmdkAiAnswer = {
  status: 'idle',
  askedQuery: null,
  content: '',
  toolInvocations: [],
  error: null,
};

const latestBot = (messages: Message[]): Message | undefined =>
  [...messages].reverse().find(m => m.type === 'bot');

const toAnswer = (state: StreamState, askedQuery: string): CmdkAiAnswer => {
  const bot = latestBot(state.messages);
  return {
    status:
      state.status === 'streaming'
        ? 'streaming'
        : state.status === 'completed'
          ? 'completed'
          : 'error',
    askedQuery,
    content: bot?.streamingContent || bot?.content || '',
    toolInvocations: bot?.toolInvocations ?? [],
    error: state.status === 'error' ? (state.error ?? 'Something went wrong') : null,
  };
};

/**
 * Streams a single answer for the cmd+K AI tab: one question, one answer, no
 * follow-ups. Each `ask` starts a fresh run and replaces the previous one.
 *
 * The run goes to the `cmdk-answer` claw agent ("Answer from Context"): claw searches
 * the given tab's scope (workspace + KB) with the user's own access, then answers in
 * one turn with no tools. Reuses the shared xyneAIStreamManager transport and keeps
 * the run out of the sidebar. A run still streaming on unmount is aborted.
 */
export function useCmdkAiAnswer(): {
  answer: CmdkAiAnswer;
  ask: (query: string, tab: string) => Promise<void>;
} {
  const [answer, setAnswer] = useState<CmdkAiAnswer>(IDLE);
  const runRef = useRef<{
    threadId: string;
    streamId: string | null;
    query: string;
    tab: string;
  } | null>(null);

  useEffect(
    () =>
      xyneAIStreamManager.subscribe((state: StreamState): void => {
        const run = runRef.current;
        if (!run || state.threadId !== run.threadId) return;
        setAnswer(toAnswer(state, run.query));
      }),
    [],
  );

  const abortCurrent = useCallback((): void => {
    const run = runRef.current;
    runRef.current = null;
    if (run?.streamId) xyneAIStreamManager.abortStream(run.streamId, 'replaced');
  }, []);

  useEffect(() => abortCurrent, [abortCurrent]);

  const ask = useCallback(
    async (query: string, tab: string): Promise<void> => {
      const trimmed = query.trim();
      if (!trimmed) return;
      // Already asking, or already answered, this exact question for this tab: leaving a
      // tab round-trip or a re-render start a second identical run costs a whole claw run
      // for an answer we are holding.
      const live = runRef.current;
      if (live && live.query === trimmed && live.tab === tab) return;
      abortCurrent();

      // A fresh global slot per question, so no history carries over.
      const threadId = buildXyneAIStreamThreadId({ streamSessionKey: crypto.randomUUID() });
      const userMessageId = `user-${Date.now()}`;
      runRef.current = { threadId, streamId: null, query: trimmed, tab };
      setAnswer({ ...IDLE, status: 'streaming', askedQuery: trimmed });

      try {
        const streamId = await xyneAIStreamManager.startStream(
          threadId,
          {
            query: trimmed,
            // claw searches this tab's scope itself, then answers once with no tools.
            agentSlug: CMDK_ANSWER_AGENT,
            // The tab claw searches for this answer (its `agentConfig.answerScope`).
            tab,
            channelIds: [],
            conversationId: '',
            webSearchEnabled: false,
            researchContext: null,
            attachments: [],
            localUserMessageId: userMessageId,
            suppressCompletionToast: true,
            showInSidebar: false,
          },
          [
            { id: userMessageId, type: 'user', content: trimmed, timestamp: new Date() },
            {
              id: `bot-${Date.now()}`,
              type: 'bot',
              content: '',
              timestamp: new Date(),
              isStreaming: true,
              parentId: userMessageId,
            },
          ],
        );
        // Replaced while the stream was being set up: abortCurrent ran before there was a
        // streamId to abort, so close it here instead of leaving it streaming unwatched.
        if (runRef.current?.threadId === threadId) runRef.current.streamId = streamId;
        else xyneAIStreamManager.abortStream(streamId, 'replaced');
      } catch (error) {
        if (runRef.current?.threadId !== threadId) return;
        // Cleared so the same question can be asked again; a failed run is not one we hold.
        runRef.current = null;
        setAnswer({
          ...IDLE,
          status: 'error',
          askedQuery: trimmed,
          error: error instanceof Error ? error.message : 'Could not start Ask AI',
        });
      }
    },
    [abortCurrent],
  );

  return { answer, ask };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContextValues } from './useAuth';
import { searchService } from '../services/searchService';
import type { CmdkAnswerEvent, CmdkAnswerSource } from '../types/search';

export type CmdkAiAnswerStatus = 'idle' | 'streaming' | 'completed' | 'error';

export interface CmdkAiAnswer {
  status: CmdkAiAnswerStatus;
  /** The query the current answer is for. */
  askedQuery: string | null;
  /** Answer markdown so far (grows while streaming). */
  content: string;
  sources: CmdkAnswerSource[];
  error: string | null;
}

const IDLE: CmdkAiAnswer = {
  status: 'idle',
  askedQuery: null,
  content: '',
  sources: [],
  error: null,
};

const FAILED = 'Could not load the AI overview';

const applyEvent = (answer: CmdkAiAnswer, event: CmdkAnswerEvent): CmdkAiAnswer => {
  switch (event.type) {
    case 'sources':
      return { ...answer, sources: event.sources };
    case 'delta':
      return { ...answer, content: answer.content + event.content };
    case 'error':
      return { ...answer, status: 'error', error: FAILED };
    default:
      return { ...answer, status: 'completed' };
  }
};

export function useCmdkAiAnswer(): {
  answer: CmdkAiAnswer;
  ask: (query: string) => void;
} {
  const { workspaceId } = useAuthContextValues();
  const [answer, setAnswer] = useState<CmdkAiAnswer>(IDLE);
  const runRef = useRef<{ query: string; controller: AbortController } | null>(null);

  const abortCurrent = useCallback((): void => {
    runRef.current?.controller.abort();
    runRef.current = null;
  }, []);

  useEffect(() => abortCurrent, [abortCurrent]);

  const ask = useCallback(
    (query: string): void => {
      const trimmed = query.trim();
      if (!trimmed || runRef.current?.query === trimmed) return;
      abortCurrent();

      const controller = new AbortController();
      runRef.current = { query: trimmed, controller };
      setAnswer({ ...IDLE, status: 'streaming', askedQuery: trimmed });

      const release = (): void => {
        if (runRef.current?.controller === controller) runRef.current = null;
      };

      searchService
        .streamCmdkAnswer(
          trimmed,
          workspaceId,
          event => {
            if (controller.signal.aborted) return;
            if (event.type === 'error') release();
            setAnswer(current => applyEvent(current, event));
          },
          controller.signal,
        )
        .then(() => {
          if (controller.signal.aborted) return;
          setAnswer(current =>
            current.status === 'streaming' ? { ...current, status: 'completed' } : current,
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          release();
          setAnswer({
            ...IDLE,
            status: 'error',
            askedQuery: trimmed,
            error: error instanceof Error ? error.message : FAILED,
          });
        });
    },
    [abortCurrent, workspaceId],
  );

  return { answer, ask };
}

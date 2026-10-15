import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { EventStreamHttpError } from '@/src/services/http/eventStream';
import { RequestAbortedError } from '@/src/services/http/request-errors';
import { Event, logger } from '@/src/utils/logger';

import type { XyneAIEvent } from '../api/xyneAIEvents';
import type { AttachedContextItem, XyneAIStreamRequest } from '../api/xyneAIRequest';
import { cancelXyneAI, streamXyneAI } from '../api/xyneAIStream';
import {
  reduceAssistantTurn,
  settleAssistantTurn,
  startAssistantTurn,
  type AssistantTurn,
  type ChatTurn,
  type StreamOutcome,
} from '../model/assistantTurn';
import type { XyneAIRequestOptions } from './useXyneAISelection';

export interface XyneAIChat {
  turns: ChatTurn[];
  isStreaming: boolean;
  send: (query: string, context?: AttachedContextItem[]) => void;
  /** Replaces the chat with a stored conversation, so follow-ups continue it. */
  open: (turns: ChatTurn[], sessionId: string) => void;
  /** Clears the chat when it is the one just deleted. */
  forget: (sessionId: string) => void;
  regenerate: () => void;
  stop: () => void;
  reset: () => void;
}

const API = 'xyne_ai_stream';

type Branch = Pick<XyneAIStreamRequest, 'parentMessageId' | 'isRegenerate'>;

function outcomeOf(error: unknown): StreamOutcome {
  if (error instanceof RequestAbortedError) return { kind: 'stopped' };
  const httpStatus = error instanceof EventStreamHttpError ? error.status : undefined;
  logger.error(Event.API_CALL_FAILED, {
    api: API,
    status: httpStatus,
    error: error instanceof Error ? error.message : String(error),
    body: error instanceof EventStreamHttpError ? error.body.slice(0, 500) : undefined,
  });
  return { kind: 'failed', httpStatus };
}

/**
 * One Xyne AI conversation. Stream events are applied at most once per frame,
 * so a fast stream re-renders the answer per frame rather than per token.
 */
export function useXyneAIChat(options: XyneAIRequestOptions): XyneAIChat {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const sessionId = useRef('');
  const traceId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);

  const stop = useCallback((): void => {
    if (traceId.current) cancelXyneAI(traceId.current).catch(() => undefined);
    controller.current?.abort();
  }, []);

  const reset = useCallback((): void => {
    stop();
    sessionId.current = '';
    setTurns([]);
  }, [stop]);

  const open = useCallback(
    (stored: ChatTurn[], storedSessionId: string): void => {
      stop();
      sessionId.current = storedSessionId;
      setTurns(stored);
    },
    [stop],
  );

  const forget = useCallback(
    (deletedSessionId: string): void => {
      if (sessionId.current === deletedSessionId) reset();
    },
    [reset],
  );

  const start = useCallback(
    (query: string, context: AttachedContextItem[] = [], branch?: Branch): void => {
      const text = query.trim();
      if (text === '') return;

      // The previous stream may still be open after `complete`, waiting for follow-ups.
      controller.current?.abort();
      traceId.current = undefined;
      const abort = new AbortController();
      controller.current = abort;

      const id = uuidv4();
      setTurns(current => [
        ...current,
        { id, query: text, context, reply: startAssistantTurn(Date.now()) },
      ]);

      const updateReply = (update: (reply: AssistantTurn) => AssistantTurn): void =>
        setTurns(current =>
          current.map(turn => (turn.id === id ? { ...turn, reply: update(turn.reply) } : turn)),
        );

      let queued: XyneAIEvent[] = [];
      let frame: number | undefined;
      const flush = (): void => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        const events = queued;
        queued = [];
        const now = Date.now();
        if (events.length > 0) {
          updateReply(reply =>
            events.reduce((turn, event) => reduceAssistantTurn(turn, event, now), reply),
          );
        }
      };

      void streamXyneAI(
        {
          ...options,
          ...branch,
          query: text,
          sessionId: sessionId.current,
          attachedContext: context,
        },
        {
          signal: abort.signal,
          onEvent: event => {
            if (abort.signal.aborted) return;
            if (event.type === 'start') {
              if (event.sessionId) sessionId.current = event.sessionId;
              traceId.current = event.traceId;
            }
            // The server may hold the stream open for follow-ups; there is nothing left to cancel.
            if (event.type === 'complete') traceId.current = undefined;
            if (event.type === 'error') {
              logger.error(Event.API_CALL_FAILED, {
                api: API,
                status: event.httpStatus,
                error: event.message,
              });
            }
            queued.push(event);
            frame ??= requestAnimationFrame(flush);
          },
        },
      )
        .then((): StreamOutcome => ({ kind: 'closed' }), outcomeOf)
        .then(outcome => {
          flush();
          updateReply(reply => settleAssistantTurn(reply, outcome, Date.now()));
          if (controller.current === abort) controller.current = null;
        });
    },
    [options],
  );

  const regenerate = useCallback((): void => {
    const last = turns.at(-1);
    if (!last || last.reply.status === 'streaming') return;
    setTurns(current => current.slice(0, -1));
    const { userMessageId } = last.reply;
    start(last.query, last.context, {
      isRegenerate: true,
      ...(userMessageId && { parentMessageId: userMessageId }),
    });
  }, [turns, start]);

  useEffect(() => stop, [stop]);

  return {
    turns,
    isStreaming: turns.at(-1)?.reply.status === 'streaming',
    send: start,
    open,
    forget,
    regenerate,
    stop,
    reset,
  };
}

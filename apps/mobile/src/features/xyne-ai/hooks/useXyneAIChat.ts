import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import { EventStreamHttpError } from '@/src/services/http/eventStream';
import { RequestAbortedError } from '@/src/services/http/request-errors';
import { Event, logger } from '@/src/utils/logger';

import { fetchConversationMessages } from '../api/xyneAIConversations';
import { DEFAULT_AGENT_SLUG } from '../api/xyneAICatalog';
import type { PendingAction, XyneAIEvent } from '../api/xyneAIEvents';
import type { AttachedContextItem, AttachedFile, XyneAIStreamRequest } from '../api/xyneAIRequest';
import {
  cancelXyneAI,
  respondToPendingAction,
  streamLiveConversation,
  streamXyneAI,
} from '../api/xyneAIStream';
import {
  activePath,
  isBranched,
  reduceAssistantTurn,
  settleAssistantTurn,
  startAssistantTurn,
  turnsFromMessages,
  versionsOf,
  type AssistantTurn,
  type ChatTurn,
  type StreamOutcome,
} from '../model/assistantTurn';
import { pickKey } from '../model/contextPicks';
import type { XyneAIRequestOptions } from './useXyneAISelection';

interface XyneAIChat {
  /** The turns on screen: one version of each question. */
  turns: ChatTurn[];
  isStreaming: boolean;
  /** False for chats stored before branching, which cannot fork. */
  canBranch: boolean;
  /** The server's id for this chat; empty until its first message is acknowledged. */
  sessionId: string;
  send: (query: string, context?: AttachedContextItem[], attachments?: AttachedFile[]) => void;
  /** Replaces the chat with a stored conversation, so follow-ups continue it, and follows its run if one is live. */
  open: (turns: ChatTurn[], sessionId: string, canBranch: boolean) => void;
  /** Re-reads the stored conversation, then follows its run if one is live. */
  refresh: () => Promise<void>;
  /** Clears the chat when it is the one just deleted. */
  forget: (sessionId: string) => void;
  regenerate: () => void;
  /** Sends the decision, then follows the run it resumes, if any. */
  respondToAction: (turnId: string, action: PendingAction, approved: boolean) => Promise<void>;
  /** Sends a new version of a question, keeping the old one as another branch. */
  edit: (
    turn: ChatTurn,
    query: string,
    context?: AttachedContextItem[],
    attachments?: AttachedFile[],
  ) => void;
  /** Where a question sits among its versions, once it has more than one. */
  versionOf: (turn: ChatTurn) => { index: number; total: number } | undefined;
  switchVersion: (turn: ChatTurn, step: 1 | -1) => void;
  stop: () => void;
  reset: () => void;
}

const API = 'xyne_ai_stream';

type Branch = { parentId: string | undefined } & Pick<
  XyneAIStreamRequest,
  | 'parentMessageId'
  | 'isRegenerate'
  | 'isEditUserMessage'
  | 'editedUserMessageId'
  | 'parentAssistantMessageId'
>;

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

/** Applies events at most once per frame, so a fast stream re-renders per frame rather than per token. */
function frameBatcher(apply: (events: XyneAIEvent[]) => void): {
  push: (event: XyneAIEvent) => void;
  flush: () => void;
} {
  let queued: XyneAIEvent[] = [];
  let frame: number | undefined;
  const flush = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    const events = queued;
    queued = [];
    if (events.length > 0) apply(events);
  };
  return {
    push: (event): void => {
      queued.push(event);
      frame ??= requestAnimationFrame(flush);
    },
    flush,
  };
}

/**
 * One Xyne AI conversation.
 */
export function useXyneAIChat(options: XyneAIRequestOptions): XyneAIChat {
  const [allTurns, setAllTurns] = useState<ChatTurn[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [canBranch, setCanBranch] = useState(true);
  const turns = useMemo(() => activePath(allTurns, chosen), [allTurns, chosen]);
  const sessionId = useRef('');
  const traceId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);

  const updateReply = useCallback(
    (turnId: string, update: (reply: AssistantTurn) => AssistantTurn): void =>
      setAllTurns(current =>
        current.map(turn => (turn.id === turnId ? { ...turn, reply: update(turn.reply) } : turn)),
      ),
    [],
  );

  const stop = useCallback((): void => {
    if (traceId.current) cancelXyneAI(traceId.current).catch(() => undefined);
    controller.current?.abort();
  }, []);

  const reset = useCallback((): void => {
    stop();
    sessionId.current = '';
    setAllTurns([]);
    setChosen({});
    setCanBranch(true);
  }, [stop]);

  const load = useCallback(
    (stored: ChatTurn[], storedSessionId: string, storedCanBranch: boolean): void => {
      sessionId.current = storedSessionId;
      setAllTurns(stored);
      setChosen({});
      setCanBranch(storedCanBranch);
    },
    [],
  );

  const forget = useCallback(
    (deletedSessionId: string): void => {
      if (sessionId.current === deletedSessionId) reset();
    },
    [reset],
  );

  const start = useCallback(
    (
      query: string,
      context: AttachedContextItem[] = [],
      attachments: AttachedFile[] = [],
      { parentId, ...branch }: Branch = { parentId: undefined },
    ): void => {
      const text = query.trim();
      if (text === '') return;

      // The previous stream may still be open after `complete`, waiting for follow-ups.
      controller.current?.abort();
      traceId.current = undefined;
      const abort = new AbortController();
      controller.current = abort;

      const id = uuidv4();
      // A first message that never reached the server has no session; the retry replaces it.
      const keepsHistory = sessionId.current !== '';
      setAllTurns(current => [
        ...(keepsHistory ? current : []),
        { id, parentId, query: text, context, attachments, reply: startAssistantTurn(Date.now()) },
      ]);
      setChosen(current => ({ ...current, [parentId ?? '']: id }));

      const batch = frameBatcher(events => {
        const now = Date.now();
        updateReply(id, reply =>
          events.reduce((turn, event) => reduceAssistantTurn(turn, event, now), reply),
        );
      });

      const scope = options.attachedContext ?? [];
      void streamXyneAI(
        {
          ...options,
          ...branch,
          query: text,
          sessionId: sessionId.current,
          attachedContext: [
            ...scope,
            ...context.filter(item => !scope.some(other => pickKey(other) === pickKey(item))),
          ],
          attachments,
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
            batch.push(event);
          },
        },
      )
        .then((): StreamOutcome => ({ kind: 'closed' }), outcomeOf)
        .then(outcome => {
          batch.flush();
          updateReply(id, reply => settleAssistantTurn(reply, outcome, Date.now()));
          if (controller.current === abort) controller.current = null;
        });
    },
    [options, updateReply],
  );

  const send = useCallback(
    (query: string, context?: AttachedContextItem[], attachments?: AttachedFile[]): void => {
      const last = sessionId.current ? turns.at(-1) : undefined;
      const parentMessageId = canBranch ? last?.reply.messageId : undefined;
      start(query, context, attachments, { parentId: last?.id, parentMessageId });
    },
    [turns, canBranch, start],
  );

  const regenerate = useCallback((): void => {
    const last = turns.at(-1);
    if (!last || last.reply.status === 'streaming') return;
    setAllTurns(current => current.filter(({ id }) => id !== last.id));
    const { userMessageId } = last.reply;
    // A question the server never acknowledged has nothing to regenerate: ask it again.
    const retryParent = canBranch
      ? allTurns.find(({ id }) => id === last.parentId)?.reply.messageId
      : undefined;
    start(
      last.query,
      last.context,
      last.attachments,
      userMessageId
        ? { parentId: last.parentId, isRegenerate: true, parentMessageId: userMessageId }
        : { parentId: last.parentId, parentMessageId: retryParent },
    );
  }, [turns, allTurns, canBranch, start]);

  // A run this device is not driving (resumed by an action, or started elsewhere) is followed on `/live`.
  const followResumedRun = useCallback(
    async (turnId: string): Promise<void> => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const conversation = {
        conversationId: sessionId.current,
        agentSlug: options.agentSlug ?? DEFAULT_AGENT_SLUG,
      };
      let isLive = false;
      let isDone = false;
      const batch = frameBatcher(events => {
        const now = Date.now();
        updateReply(turnId, reply =>
          events.reduce((turn, event) => reduceAssistantTurn(turn, event, now), reply),
        );
      });

      await streamLiveConversation(conversation, {
        signal: abort.signal,
        onFrame: ({ events, ended, isSnapshot }) => {
          if (isSnapshot) {
            batch.flush();
            updateReply(turnId, reply => ({
              ...reply,
              parts: reply.parts.filter(({ id }) => !id.startsWith('live-')),
            }));
          }
          if (events.length > 0 && !isLive) {
            isLive = true;
            updateReply(turnId, reply => ({ ...reply, status: 'streaming' }));
          }
          events.forEach(batch.push);
          if (ended) {
            isDone = true;
            abort.abort();
          }
        },
      }).catch(() => undefined);

      batch.flush();
      // No run was live, so the stored transcript already matches the screen.
      if (!isLive) return;
      const isStopped = abort.signal.aborted && !isDone;
      updateReply(turnId, reply =>
        settleAssistantTurn(reply, { kind: isStopped ? 'stopped' : 'closed' }, Date.now()),
      );
      if (isStopped) return;

      const stored = await fetchConversationMessages(conversation).catch(() => undefined);
      if (
        stored &&
        controller.current === abort &&
        sessionId.current === conversation.conversationId
      ) {
        load(turnsFromMessages(stored), conversation.conversationId, isBranched(stored));
      }
    },
    [options.agentSlug, updateReply, load],
  );

  const resume = useCallback(
    (stored: ChatTurn[], storedSessionId: string, storedCanBranch: boolean): void => {
      load(stored, storedSessionId, storedCanBranch);
      const last = activePath(stored, {}).at(-1);
      if (last) void followResumedRun(last.id);
    },
    [load, followResumedRun],
  );

  const open = useCallback(
    (stored: ChatTurn[], storedSessionId: string, storedCanBranch: boolean): void => {
      stop();
      resume(stored, storedSessionId, storedCanBranch);
    },
    [stop, resume],
  );

  const lastReplyStatus = useRef<AssistantTurn['status']>(undefined);
  lastReplyStatus.current = turns.at(-1)?.reply.status;

  const refresh = useCallback(async (): Promise<void> => {
    const conversation = {
      conversationId: sessionId.current,
      agentSlug: options.agentSlug ?? DEFAULT_AGENT_SLUG,
    };
    if (!conversation.conversationId || lastReplyStatus.current === 'streaming') return;
    const stored = await fetchConversationMessages(conversation).catch(() => undefined);
    // Not `open`: stopping would cancel the very run being picked back up.
    if (stored && sessionId.current === conversation.conversationId) {
      resume(turnsFromMessages(stored), conversation.conversationId, isBranched(stored));
    }
  }, [options.agentSlug, resume]);

  // A run cut off while the app was away, or continued elsewhere, is picked up on return.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      const status = lastReplyStatus.current;
      if (state === 'active' && (status === 'stopped' || status === 'error')) void refresh();
    });
    return (): void => subscription.remove();
  }, [refresh]);

  const respondToAction = useCallback(
    async (turnId: string, action: PendingAction, approved: boolean): Promise<void> => {
      const agentSlug = options.agentSlug ?? DEFAULT_AGENT_SLUG;
      await respondToPendingAction({ sessionId: sessionId.current, agentSlug }, action, approved);
      const resolution = approved ? 'approved' : 'declined';
      updateReply(turnId, reply => ({
        ...reply,
        pendingActions: reply.pendingActions.map(pending =>
          pending.id === action.id ? { ...pending, resolution } : pending,
        ),
      }));
      void followResumedRun(turnId);
    },
    [options.agentSlug, updateReply, followResumedRun],
  );

  const edit = useCallback(
    (
      turn: ChatTurn,
      query: string,
      context: AttachedContextItem[] = [],
      attachments: AttachedFile[] = [],
    ): void => {
      const parentMessageId = allTurns.find(({ id }) => id === turn.parentId)?.reply.messageId;
      // The original picks go with the new version, plus anything added while editing.
      const original = new Set(turn.context.map(pickKey));
      const added = context.filter(item => !original.has(pickKey(item)));
      start(query, [...turn.context, ...added], [...turn.attachments, ...attachments], {
        parentId: turn.parentId,
        parentMessageId,
        parentAssistantMessageId: parentMessageId,
        isEditUserMessage: true,
        editedUserMessageId: turn.reply.userMessageId,
      });
    },
    [allTurns, start],
  );

  const versionOf = useCallback(
    (turn: ChatTurn): { index: number; total: number } | undefined => {
      const versions = versionsOf(allTurns, turn);
      return versions.length > 1
        ? { index: versions.findIndex(({ id }) => id === turn.id), total: versions.length }
        : undefined;
    },
    [allTurns],
  );

  const switchVersion = useCallback(
    (turn: ChatTurn, step: 1 | -1): void => {
      const versions = versionsOf(allTurns, turn);
      const index = versions.findIndex(({ id }) => id === turn.id);
      const next = versions[(index + step + versions.length) % versions.length];
      if (next) setChosen(current => ({ ...current, [turn.parentId ?? '']: next.id }));
    },
    [allTurns],
  );

  // Leaving the screen detaches only; the server run continues and `open` reattaches to it.
  useEffect(() => (): void => controller.current?.abort(), []);

  return {
    turns,
    isStreaming: allTurns.some(({ reply }) => reply.status === 'streaming'),
    canBranch,
    sessionId: sessionId.current,
    send,
    open,
    refresh,
    forget,
    regenerate,
    respondToAction,
    edit,
    versionOf,
    switchVersion,
    stop,
    reset,
  };
}

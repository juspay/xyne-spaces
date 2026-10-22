import { useCallback, useEffect, useRef } from 'react';
import { isAxiosError } from 'axios';
import {
  saveV2ConversationNotes,
  type ConversationNote,
  type SavedConversationNotes,
} from '../../services/XyneAI/XyneAISessionsV2Service';
import { logger, Event as LogEvent } from '../../utils/logger';

/** claw-auth takes up to this many turns in one save. */
const TURNS_PER_SAVE = 5;
/** A save refused while a reply was running is tried again after this, at most RETRIES times. */
const RETRY_MS = 3_000;
const RETRIES = 3;
const DIRECT_CHAT_PREFIX = 'chat-';

/** A turn as shown: when it was asked, and the local turn standing in for it until it is saved. */
export interface BuddyTurn extends ConversationNote {
  at: Date;
  localId?: string;
}

interface Pending extends BuddyTurn {
  conversationId: string;
  /** The reply the user was on, so the saved turn follows it. */
  parentId: string | undefined;
  tries: number;
}

export interface SavedBuddyTurns extends SavedConversationNotes {
  turns: BuddyTurn[];
}

interface Options {
  /** Off where the chat is not claw-backed (v1). */
  enabled: boolean;
  conversationId: string;
  agentSlug: string | null;
  /** A reply streaming in this panel: saves wait for it, or they would land beside it. */
  streaming: boolean;
  /** A new chat got its id from the first save, as it would from a first Ask AI turn. */
  onStarted: (conversationId: string) => void;
  onSaved: (saved: SavedBuddyTurns) => void;
}

/** The first turns that go to the same conversation, taken off the queue. */
export const takeBatch = <T extends { conversationId: string }>(queue: T[]): T[] => {
  const [first] = queue;
  if (!first) return [];
  let count = 0;
  while (
    count < queue.length &&
    count < TURNS_PER_SAVE &&
    queue[count]?.conversationId === first.conversationId
  ) {
    count++;
  }
  return queue.splice(0, count);
};

const refusedWhileRunning = (error: unknown): boolean =>
  isAxiosError(error) && error.response?.status === 409;

/**
 * Saves what Buddy did on screen into the open chat, so it is in the history; `onSaved` gets the
 * rows made, to stand in for the local turns. A failed save is only logged. Saves go one at a
 * time, in order.
 */
export const useSaveBuddyTurns = ({
  enabled,
  conversationId,
  agentSlug,
  streaming,
  onStarted,
  onSaved,
}: Options): ((turn: BuddyTurn & { parentId?: string | undefined }) => void) => {
  const queue = useRef<Pending[]>([]);
  const saving = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ enabled, conversationId, agentSlug, streaming, onStarted, onSaved });
  latest.current = { enabled, conversationId, agentSlug, streaming, onStarted, onSaved };

  const flush = useCallback(async (): Promise<void> => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (queue.current.length > 0 && !latest.current.streaming) {
        const batch = takeBatch(queue.current);
        const [first] = batch;
        if (!first) break;
        try {
          const saved = await saveV2ConversationNotes(
            first.conversationId,
            batch.map(({ request, reply }) => ({ request, reply })),
            latest.current.agentSlug,
            first.parentId,
          );
          latest.current.onSaved({
            ...saved,
            turns: batch.map(({ request, reply, at, localId }) => ({
              request,
              reply,
              at,
              ...(localId ? { localId } : {}),
            })),
          });
        } catch (error) {
          if (refusedWhileRunning(error) && first.tries < RETRIES) {
            queue.current.unshift(...batch.map(turn => ({ ...turn, tries: turn.tries + 1 })));
            if (retry.current === null) {
              retry.current = setTimeout(() => {
                retry.current = null;
                void flush();
              }, RETRY_MS);
            }
            break;
          }
          logger.warn(LogEvent.FRONTEND_ERROR, {
            message: '[Buddy] could not save turns to the chat history',
            status: isAxiosError(error) ? error.response?.status : undefined,
          });
        }
      }
    } finally {
      saving.current = false;
    }
  }, []);

  // Turns held back while a reply streamed go once it has finished.
  useEffect(() => {
    if (!streaming) void flush();
  }, [streaming, flush]);

  useEffect(
    () => (): void => {
      if (retry.current !== null) clearTimeout(retry.current);
    },
    [],
  );

  return useCallback(
    ({
      request,
      reply,
      at,
      localId,
      parentId,
    }: BuddyTurn & { parentId?: string | undefined }): void => {
      const said = request.trim();
      const answered = reply.trim();
      if (!latest.current.enabled || !said || !answered) return;
      let id = latest.current.conversationId;
      if (!id) {
        // Set on the ref at once, so a second turn before the next render joins this chat.
        id = `${DIRECT_CHAT_PREFIX}${crypto.randomUUID()}`;
        latest.current.conversationId = id;
        latest.current.onStarted(id);
      }
      if (!id.startsWith(DIRECT_CHAT_PREFIX)) return;
      queue.current.push({
        conversationId: id,
        request: said,
        reply: answered,
        at,
        ...(localId ? { localId } : {}),
        parentId,
        tries: 0,
      });
      void flush();
    },
    [flush],
  );
};

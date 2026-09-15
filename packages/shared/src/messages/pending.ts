import { v4 as uuidv4 } from 'uuid';
import type { Zero } from '@rocicorp/zero';
import { getSyncStorage } from '../platform/syncStorage.js';
import { queries } from '../zero/queries.js';
import { mutators } from '../zero/mutators.js';
import { MessageType } from '../zero/schema.js';
import type { EntityLinkContextInput } from '../sdlc.js';
import type { ConversationRef } from './conversationRef.js';
import { subscribeSendLifecycle } from './mutationLifecycle.js';

const PENDING_STORAGE_KEY = 'pendingMessages';

export type ZeroStateName =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'needs-auth'
  | 'error'
  | 'closed';

export type PendingKind = 'channel' | 'thread';

export type PendingAttachment = {
  attachmentId: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
};

export type PendingMessage = {
  messageId: string;
  conversationId: string;
  channelId: string;
  workspaceId: string | null;
  kind: PendingKind;
  senderId: string;
  content: string;
  text: string;
  timestamp: number;
  type: MessageType;
  alsoSendToChannel?: boolean;
  childConversationId?: string;
  attachments?: PendingAttachment[];
  entityLinkContext?: EntityLinkContextInput;
  sessionId: string;
  zeroStateAtSend: ZeroStateName;
  mutatorFired: boolean;
  mutatorAppError: boolean;
};

export type PendingStatus = 'connecting' | 'failed';

const currentSessionId: string = uuidv4();

const listeners = new Set<() => void>();

function readAll(): Record<string, PendingMessage> {
  try {
    const raw = getSyncStorage().getItem(PENDING_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PendingMessage>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, PendingMessage>): void {
  try {
    getSyncStorage().setItem(PENDING_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
  for (const cb of listeners) {
    try {
      cb();
    } catch {}
  }
}

export function getCurrentSessionId(): string {
  return currentSessionId;
}

export function addPending(entry: PendingMessage): void {
  const all = readAll();
  all[entry.messageId] = entry;
  writeAll(all);
}

export function removePending(messageId: string): void {
  const all = readAll();
  if (!(messageId in all)) return;
  delete all[messageId];
  writeAll(all);
}

export function updatePending(
  messageId: string,
  patch: Partial<PendingMessage>,
): void {
  const all = readAll();
  const existing = all[messageId];
  if (!existing) return;
  all[messageId] = { ...existing, ...patch };
  writeAll(all);
}

export function getAllPending(): PendingMessage[] {
  return Object.values(readAll());
}

export function getPendingForChannel(channelId: string): PendingMessage[] {
  return getAllPending().filter(
    e => e.kind === 'channel' && e.channelId === channelId,
  );
}

export function getPendingForThread(conversationId: string): PendingMessage[] {
  return getAllPending().filter(
    e => e.kind === 'thread' && e.conversationId === conversationId,
  );
}

export function subscribePending(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getStatus(entry: PendingMessage): PendingStatus | null {
  // Anything from a previous session or with a mutator app-error is failed.
  if (entry.sessionId !== currentSessionId || entry.mutatorAppError) {
    return 'failed';
  }
  switch (entry.zeroStateAtSend) {
    case 'connecting':
      // Auto-retry-eligible clock: fires once Zero transitions to connected.
      return 'connecting';
    case 'connected':
      // Mutator was fired (or will be, momentarily). Awaiting server ack;
      // the messagesByIds reconcile drops the entry when isSent=true.
      return null;
    default:
      // disconnected / needs-auth / error / closed → manual-retry failed.
      return 'failed';
  }
}

/**
 * Fires the mutator for a pending entry using the same messageId (idempotent
 * server-side per user's note). Updates entry state through the send lifecycle
 * and removes on success.
 */
export function firePendingMutator(zero: Zero, entry: PendingMessage): void {
  const fireTimestamp = Date.now();
  updatePending(entry.messageId, {
    mutatorFired: true,
    mutatorAppError: false,
    timestamp: fireTimestamp,
    sessionId: currentSessionId,
    zeroStateAtSend: zero.connection.state.current.name as ZeroStateName,
  });

  let childConversationId: string | undefined = entry.childConversationId;
  // Replay is hermetic: a queued or retried send carries its own attachment set
  // on the pending entry, so pass attachmentIds explicitly here (even when empty).
  // This forces the server mutator down its explicit branch, which links exactly
  // these ids and leaves any other draft attachments untouched. Do NOT omit it on
  // the empty case the way sendMessage does on first fire: an omitted attachmentIds
  // drops the mutator into the legacy draft-scan fallback, which would promote
  // whatever is in the channel draft *now* (a concurrent, unrelated compose) onto
  // this replayed message and delete that draft.
  const attachmentIds = entry.attachments?.map(a => a.attachmentId) ?? [];
  let mutation;
  if (entry.kind === 'channel') {
    mutation = zero.mutate(
      mutators.conversations.send({
        channelId: entry.channelId,
        content: entry.content,
        conversationId: entry.conversationId,
        messageId: entry.messageId,
        timestamp: fireTimestamp,
        type: entry.type,
        attachmentIds,
        ...(entry.entityLinkContext !== undefined && { entityLinkContext: entry.entityLinkContext }),
      }),
    );
  } else {
    mutation = zero.mutate(
      mutators.messages.send({
        conversationId: entry.conversationId,
        content: entry.content,
        type: entry.type,
        timestamp: fireTimestamp,
        messageId: entry.messageId,
        attachmentIds,
        ...(entry.alsoSendToChannel !== undefined && {
          showInChannel: entry.alsoSendToChannel,
        }),
        ...(childConversationId !== undefined && { childConversationId }),
      }),
    );
  }

  subscribeSendLifecycle(
    mutation,
    () => {
      updatePending(entry.messageId, { mutatorAppError: true });
    },
    outcome => {
      if (outcome === 'ok') {
        removePending(entry.messageId);
      }
    },
  );
}

export function isAutoRetryEligible(entry: PendingMessage): boolean {
  return (
    entry.sessionId === currentSessionId &&
    entry.zeroStateAtSend === 'connecting' &&
    !entry.mutatorFired &&
    !entry.mutatorAppError
  );
}

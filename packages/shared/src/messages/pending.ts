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

/**
 * How long a fired send may stay unacknowledged before we stop believing the
 * ack is coming.
 *
 * A send fired while Zero reports `connected` used to have no clock at all: no
 * status, no retry, no error. If the socket died between `zero.mutate()` and
 * the server ack (or the client group was rebuilt, which makes Zero discard its
 * unacked queue), the optimistic row disappeared and nothing replayed it — the
 * message was silently lost until the next app session.
 */
export const SEND_ACK_TIMEOUT_MS = 15_000;

/**
 * Cap on unattended replays of one message. Past this the entry stays `failed`
 * and only an explicit user retry fires it again, so a mutator that keeps
 * losing its ack cannot turn into an endless background resend loop.
 */
export const MAX_AUTO_RETRIES = 3;

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
  /** Wall clock of the last mutator fire. Absent on entries queued offline. */
  firedAt?: number;
  /** Unattended replays so far. Reset by an explicit user retry. */
  autoRetryCount?: number;
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
  notifyPendingSubscribers();
}

/**
 * Re-run every pending subscriber without mutating storage.
 *
 * {@linkcode getStatus} is time-dependent (see {@linkcode SEND_ACK_TIMEOUT_MS}),
 * so a stuck send only flips to `failed` when something re-reads it. The sweep
 * in `usePendingQueue` calls this on a timer.
 */
export function notifyPendingSubscribers(): void {
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

/**
 * True when the mutator was fired but the server ack never arrived inside
 * {@linkcode SEND_ACK_TIMEOUT_MS}. The reconcile in `usePendingQueue` removes
 * the entry as soon as the server confirms `isSent`, so an entry that is still
 * here past the deadline was never persisted.
 */
export function isAckOverdue(
  entry: PendingMessage,
  now: number = Date.now(),
): boolean {
  if (!entry.mutatorFired) return false;
  const firedAt = entry.firedAt ?? entry.timestamp;
  return now - firedAt > SEND_ACK_TIMEOUT_MS;
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
      // Mutator was fired (or will be, momentarily). Awaiting server ack; the
      // messagesByIds reconcile drops the entry when isSent=true. Past the ack
      // deadline the write is treated as lost: surface the same failed UI as an
      // offline send so the user gets retry/delete instead of a silent drop.
      return isAckOverdue(entry) ? 'failed' : 'connecting';
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
export function firePendingMutator(
  zero: Zero,
  entry: PendingMessage,
  options: { manual?: boolean } = {},
): void {
  const fireTimestamp = Date.now();
  updatePending(entry.messageId, {
    mutatorFired: true,
    mutatorAppError: false,
    timestamp: fireTimestamp,
    firedAt: fireTimestamp,
    autoRetryCount: options.manual ? 0 : (entry.autoRetryCount ?? 0) + 1,
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

/**
 * Entries the reconnect sweep may replay without user action.
 *
 * Two cases, both scoped to the current session (older entries surface the
 * manual retry UI instead):
 *  - queued while Zero was not connected and never attempted;
 *  - fired while `connected` but never acknowledged before the deadline —
 *    i.e. the socket or the client group died mid-flight. Zero drops its own
 *    unacked queue on `ClientStateNotFound`, so this replay is the only thing
 *    that lands the message.
 *
 * Replay is safe because the server mutator is idempotent per `messageId`
 * (`firePendingMutator` deliberately reuses the original id).
 */
export function isAutoRetryEligible(entry: PendingMessage): boolean {
  if (entry.sessionId !== currentSessionId || entry.mutatorAppError) {
    return false;
  }
  if ((entry.autoRetryCount ?? 0) >= MAX_AUTO_RETRIES) return false;
  if (!entry.mutatorFired) return true;
  return isAckOverdue(entry);
}

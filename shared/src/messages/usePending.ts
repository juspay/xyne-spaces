import { useSyncExternalStore } from 'react';
import {
  getAllPending,
  getPendingRevision,
  getPendingForChannel,
  getPendingForThread,
  getStatus,
  subscribePending,
  type PendingMessage,
  type PendingStatus,
} from './pending.js';

type CachedSnapshot<T> = {
  revision: number;
  value: T;
};

const channelSnapshots = new Map<string, CachedSnapshot<PendingMessage[]>>();
const threadSnapshots = new Map<string, CachedSnapshot<PendingMessage[]>>();
const messageSnapshots = new Map<
  string,
  CachedSnapshot<PendingMessage | null>
>();

const clearCachedSnapshots = (): void => {
  channelSnapshots.clear();
  threadSnapshots.clear();
  messageSnapshots.clear();
};

const getCachedSnapshot = <T>(
  cache: Map<string, CachedSnapshot<T>>,
  key: string,
  read: () => T,
): T => {
  const revision = getPendingRevision();
  const cached = cache.get(key);
  if (cached?.revision === revision) return cached.value;

  const value = read();
  cache.set(key, { revision, value });
  return value;
};

const subscribeToPendingSnapshots = (onStoreChange: () => void): (() => void) =>
  subscribePending(() => {
    clearCachedSnapshots();
    onStoreChange();
  });

export function usePendingForChannel(channelId: string): PendingMessage[] {
  return useSyncExternalStore(
    subscribeToPendingSnapshots,
    () =>
      getCachedSnapshot(channelSnapshots, channelId, () =>
        getPendingForChannel(channelId),
      ),
    () =>
      getCachedSnapshot(channelSnapshots, channelId, () =>
        getPendingForChannel(channelId),
      ),
  );
}

export function usePendingForThread(conversationId: string): PendingMessage[] {
  return useSyncExternalStore(
    subscribeToPendingSnapshots,
    () =>
      getCachedSnapshot(threadSnapshots, conversationId, () =>
        getPendingForThread(conversationId),
      ),
    () =>
      getCachedSnapshot(threadSnapshots, conversationId, () =>
        getPendingForThread(conversationId),
      ),
  );
}

function findPendingByMessageId(messageId: string): PendingMessage | undefined {
  return getAllPending().find(p => p.messageId === messageId);
}

export function usePendingByMessageId(
  messageId: string,
): PendingMessage | null {
  return useSyncExternalStore(
    subscribeToPendingSnapshots,
    () =>
      getCachedSnapshot(
        messageSnapshots,
        messageId,
        () => findPendingByMessageId(messageId) ?? null,
      ),
    () =>
      getCachedSnapshot(
        messageSnapshots,
        messageId,
        () => findPendingByMessageId(messageId) ?? null,
      ),
  );
}

export function usePendingStatusByMessageId(
  messageId: string,
): PendingStatus | null {
  const entry = usePendingByMessageId(messageId);
  return entry ? getStatus(entry) : null;
}

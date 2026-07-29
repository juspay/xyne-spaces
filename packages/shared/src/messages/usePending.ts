import { useEffect, useState } from 'react';
import {
  getAllPending,
  getPendingForChannel,
  getPendingForThread,
  getStatus,
  subscribePending,
  type PendingMessage,
  type PendingStatus,
} from './pending.js';

export function usePendingForChannel(channelId: string): PendingMessage[] {
  const [snap, setSnap] = useState<PendingMessage[]>(() =>
    getPendingForChannel(channelId),
  );
  useEffect(() => {
    setSnap(getPendingForChannel(channelId));
    return subscribePending(() => {
      setSnap(getPendingForChannel(channelId));
    });
  }, [channelId]);
  return snap;
}

export function usePendingForThread(conversationId: string): PendingMessage[] {
  const [snap, setSnap] = useState<PendingMessage[]>(() =>
    getPendingForThread(conversationId),
  );
  useEffect(() => {
    setSnap(getPendingForThread(conversationId));
    return subscribePending(() => {
      setSnap(getPendingForThread(conversationId));
    });
  }, [conversationId]);
  return snap;
}

function findPendingByMessageId(messageId: string): PendingMessage | undefined {
  return getAllPending().find(p => p.messageId === messageId);
}

export function usePendingByMessageId(messageId: string): PendingMessage | null {
  const [snap, setSnap] = useState<PendingMessage | null>(
    () => findPendingByMessageId(messageId) ?? null,
  );
  useEffect(() => {
    setSnap(findPendingByMessageId(messageId) ?? null);
    return subscribePending(() => {
      setSnap(findPendingByMessageId(messageId) ?? null);
    });
  }, [messageId]);
  return snap;
}

export function usePendingStatusByMessageId(
  messageId: string,
): PendingStatus | null {
  const entry = usePendingByMessageId(messageId);
  return entry ? getStatus(entry) : null;
}

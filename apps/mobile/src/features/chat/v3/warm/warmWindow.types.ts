/**
 * Design §5.5. Rows are the cached conversation window — never a second
 * in-memory copy of live `useMessages` data.
 */

export type WarmKind = 'channel' | 'thread';

export type WarmRow = {
  conversationId?: string;
  initialMessageId?: string | null;
  messageId?: string | null;
  createdAt?: number;
};

export type WarmWindow = {
  kind: WarmKind;
  id: string;
  rows: readonly WarmRow[];
  /** Original cached conversation records. Used to paint until live arrives. */
  records: readonly unknown[];
  fingerprint: string;
  readAt: number;
  /** Decided by `containsChatWindowTarget` — never re-implemented here. */
  containsTarget: boolean;
};

/** Matches `mmkvStorageAdapter` LRU caps. Adjust only with a measurement. */
export const WARM_CACHE_CAPS = {
  maxDiskChannels: 100,
  maxDiskThreads: 50,
  maxDiskChannelRows: 200,
} as const;

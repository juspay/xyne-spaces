import { getJson, setJson } from '@/src/services/localStorage';

const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ThreadCursor = {
  lastReplyAt: number;
  id: string;
};

export type ConversationParticipantRow = {
  id: string;
  conversationId: string;
  userId: string;
  channelId?: string | undefined;
  participationType?: string | undefined;
  isSubscribed: boolean;
  joinedAt: number;
  lastReadAt?: number | undefined;
  lastReplyAt?: number | undefined;
};

type ThreadsSnapshot = {
  version: typeof VERSION;
  rows: ConversationParticipantRow[];
  nextCursor: ThreadCursor | null;
  hasMore: boolean;
  savedAt: number;
};

const snapshotKey = (userId: string) => `@lotus_threads_snapshot:${userId}:v${VERSION}`;

export function readThreadsSnapshot(userId: string): ThreadsSnapshot | null {
  if (!userId) return null;
  const data = getJson<ThreadsSnapshot>(snapshotKey(userId));
  if (!data || data.version !== VERSION) return null;
  if (!Array.isArray(data.rows) || data.rows.length === 0) return null;
  if (Date.now() - data.savedAt > MAX_AGE_MS) return null;
  return data;
}

export function persistThreadsSnapshot(
  userId: string,
  rows: ConversationParticipantRow[],
  nextCursor: ThreadCursor | null,
  hasMore: boolean,
): void {
  if (!userId || rows.length === 0) return;
  setJson(snapshotKey(userId), {
    version: VERSION,
    rows,
    nextCursor,
    hasMore,
    savedAt: Date.now(),
  } satisfies ThreadsSnapshot);
}

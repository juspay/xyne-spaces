import { isJumpEntry } from './entryPoint';
import { err, ok, type OpenIntent, type OpenSurface, type Result } from './openIntent.types';
import type { ResolvedAnchor, ResolvedLocation, UnreadBoundary } from './resolvedLocation';
import type { OpenFailure } from '../types/openFailure';

export type ChannelStatusSnapshot = {
  lastViewedAt?: number;
  lastViewedConversationId?: string;
};

export type ResolveLocationDeps = {
  snapshotRows: readonly unknown[];
  readCachedTicketId: (ids: { channelId: string; threadId: string }) => string | null;
  runMessage: (messageId: string) => Promise<unknown>;
  runConversation: (conversationId: string) => Promise<unknown>;
  readChannelStatus: (channelId: string) => ChannelStatusSnapshot | null;
  now?: () => number;
  budgetMs?: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const positive = (value: unknown): number | null => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const snapshotCreatedAt = (rows: readonly unknown[], messageId: string): number => {
  for (const value of rows) {
    const row = asRecord(value);
    if (!row) {
      continue;
    }
    const matches =
      str(row['messageId']) === messageId || str(row['initialMessageId']) === messageId;
    const createdAt = positive(row['createdAt']);
    if (matches && createdAt !== null) {
      return createdAt;
    }
  }
  return 0;
};

const newestSnapshotCreatedAt = (rows: readonly unknown[]): number => {
  let newest = 0;
  for (const value of rows) {
    const createdAt = positive(asRecord(value)?.['createdAt']);
    if (createdAt !== null && createdAt > newest) {
      newest = createdAt;
    }
  }
  return newest;
};

const ticketIdOf = (conversation: Record<string, unknown> | null): string | null => {
  if (!conversation) {
    return null;
  }
  const nested = asRecord(conversation['ticket']);
  return str(conversation['ticketId']) ?? str(nested?.['id']);
};

const parentMessageIdOf = (conversation: Record<string, unknown> | null): string | null =>
  str(conversation?.['parentMessageId']);

/** List-tap cursor only. Live lastViewedAt never rewrites `at`. */
const unreadBoundaryOf = (
  intent: OpenIntent,
  status: ChannelStatusSnapshot | null,
  newestKnown: number,
): UnreadBoundary | null => {
  const hinted = intent.hint.unreadBoundaryAt;
  if (hinted === undefined) {
    return null;
  }
  // Stale: the list still said unread, but nothing in the window is after it.
  if (hinted <= 0 || (newestKnown > 0 && hinted >= newestKnown)) {
    return null;
  }
  const conversationId =
    intent.hint.unreadBoundaryConversationId ?? status?.lastViewedConversationId;
  return conversationId ? { at: hinted, conversationId } : { at: hinted };
};

const threadSurface = (
  channelId: string,
  threadId: string,
  ticketId: string | null,
): OpenSurface =>
  ticketId
    ? { kind: 'ticket-thread', channelId, threadId, ticketId }
    : { kind: 'thread', channelId, threadId };

const locationOf = (
  intent: OpenIntent,
  surface: OpenSurface,
  anchor: ResolvedAnchor | null,
  deps: ResolveLocationDeps,
): ResolvedLocation => ({
  surface,
  anchor,
  unreadBoundary: unreadBoundaryOf(
    intent,
    deps.readChannelStatus(intent.hint.channelId),
    newestSnapshotCreatedAt(deps.snapshotRows),
  ),
});

const parseConversation = (
  value: unknown,
): {
  channelId: string;
  conversationId: string;
  createdAt: number;
  record: Record<string, unknown>;
} | null => {
  const record = asRecord(value);
  const channelId = str(record?.['channelId']);
  const conversationId = str(record?.['conversationId']);
  const createdAt = positive(record?.['createdAt']);
  if (!record || !channelId || !conversationId || createdAt === null) {
    return null;
  }
  return { channelId, conversationId, createdAt, record };
};

const parseMessage = (
  value: unknown,
): {
  messageId: string;
  createdAt: number;
  isDeleted: boolean;
  conversation: Record<string, unknown> | null;
} | null => {
  const record = asRecord(value);
  const messageId = str(record?.['messageId']);
  if (!record || !messageId) {
    return null;
  }
  return {
    messageId,
    createdAt: positive(record['createdAt']) ?? 0,
    isDeleted: record['isDeleted'] === true,
    conversation: asRecord(record['conversation']),
  };
};

const surfaceFromConversation = (
  intent: OpenIntent,
  conversation: Record<string, unknown>,
  conversationId: string,
  deps: ResolveLocationDeps,
): Result<OpenSurface, OpenFailure> => {
  const channelId = str(conversation['channelId']) ?? intent.hint.channelId;
  if (channelId !== intent.hint.channelId) {
    return err({ reason: 'not-found' });
  }
  const initialMessageId = str(conversation['initialMessageId']);
  const hintedMessageId = intent.hint.messageId;
  const isMain =
    !intent.hint.threadId &&
    (!hintedMessageId || hintedMessageId === initialMessageId) &&
    !parentMessageIdOf(conversation);
  if (isMain) {
    return ok({ kind: 'channel', channelId });
  }
  const ticketId =
    ticketIdOf(conversation) ?? deps.readCachedTicketId({ channelId, threadId: conversationId });
  return ok(threadSurface(channelId, conversationId, ticketId));
};

const withTimeout = async <T>(promise: Promise<T>, remainMs: number): Promise<T> => {
  if (remainMs <= 0) {
    throw new Error('timeout');
  }
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), remainMs);
    }),
  ]);
};

const resolveJumpByMessage = async (
  intent: OpenIntent,
  messageId: string,
  deps: ResolveLocationDeps,
  remainMs: number,
): Promise<Result<ResolvedLocation, OpenFailure>> => {
  const snapshotAt = snapshotCreatedAt(deps.snapshotRows, messageId);
  if (snapshotAt > 0 && intent.surface.kind === 'channel' && !intent.hint.threadId) {
    return ok(
      locationOf(
        intent,
        intent.surface,
        {
          conversationId: intent.hint.conversationId ?? messageId,
          messageId,
          createdAt: snapshotAt,
        },
        deps,
      ),
    );
  }
  const queried = await withTimeout(deps.runMessage(messageId), remainMs);
  const parsed = parseMessage(queried);
  if (!parsed || parsed.isDeleted) {
    return err({ reason: 'not-found' });
  }
  const conversation = parsed.conversation;
  const parsedConversation = conversation ? parseConversation(conversation) : null;
  const conversationId =
    parsedConversation?.conversationId ??
    intent.hint.conversationId ??
    intent.hint.threadId ??
    messageId;
  const createdAt = parsed.createdAt > 0 ? parsed.createdAt : snapshotAt;
  if (createdAt <= 0) {
    return err({ reason: 'not-found' });
  }
  const surface = conversation
    ? surfaceFromConversation(intent, conversation, conversationId, deps)
    : ok(intent.surface);
  if (!surface.ok) {
    return surface;
  }
  const anchor: ResolvedAnchor = { conversationId, messageId, createdAt };
  return ok(locationOf(intent, surface.value, anchor, deps));
};

const resolveJumpByConversation = async (
  intent: OpenIntent,
  conversationId: string,
  deps: ResolveLocationDeps,
  remainMs: number,
): Promise<Result<ResolvedLocation, OpenFailure>> => {
  const queried = await withTimeout(deps.runConversation(conversationId), remainMs);
  const parsed = parseConversation(queried);
  if (!parsed) {
    return err({ reason: 'not-found' });
  }
  const surface = surfaceFromConversation(intent, parsed.record, parsed.conversationId, deps);
  if (!surface.ok) {
    return surface;
  }
  const messageId = str(parsed.record['initialMessageId']) ?? parsed.conversationId;
  const anchor: ResolvedAnchor = {
    conversationId: parsed.conversationId,
    messageId,
    createdAt: parsed.createdAt,
  };
  return ok(locationOf(intent, surface.value, anchor, deps));
};

const resolveLocal = (
  intent: OpenIntent,
  deps: ResolveLocationDeps,
): Result<ResolvedLocation, OpenFailure> => {
  const ticketId =
    intent.surface.kind === 'ticket-thread'
      ? intent.surface.ticketId
      : intent.hint.threadId
        ? deps.readCachedTicketId({
            channelId: intent.hint.channelId,
            threadId: intent.hint.threadId,
          })
        : null;
  const surface: OpenSurface =
    ticketId && intent.hint.threadId
      ? threadSurface(intent.hint.channelId, intent.hint.threadId, ticketId)
      : intent.surface;
  return ok(locationOf(intent, surface, null, deps));
};

/**
 * One resolver. How we arrived does not pick the landing; the payload does.
 *
 *   named message                         → fetch it (push, link, search, show-in-channel)
 *   jump entry + conversation, no message → fetch that conversation
 *   else                                  → tail (unread divider is row chrome, not a landing)
 *
 * `hint.createdAt` is never the anchor cursor (it is often the parent).
 */
export const resolveLocation = async (
  intent: OpenIntent,
  deps: ResolveLocationDeps,
): Promise<Result<ResolvedLocation, OpenFailure>> => {
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? 4_000;
  const started = now();
  const remain = (): number => budgetMs - (now() - started);
  try {
    const messageId = intent.hint.messageId;
    if (messageId) {
      return await resolveJumpByMessage(intent, messageId, deps, remain());
    }
    const conversationId = intent.hint.conversationId ?? intent.hint.threadId;
    if (isJumpEntry(intent.entry) && conversationId && !intent.hint.threadId) {
      return await resolveJumpByConversation(intent, conversationId, deps, remain());
    }
    if (isJumpEntry(intent.entry) && intent.hint.threadId) {
      return await resolveJumpByConversation(intent, intent.hint.threadId, deps, remain());
    }
    return resolveLocal(intent, deps);
  } catch (error) {
    if (error instanceof Error && error.message === 'timeout') {
      return err({ reason: 'timeout', stage: 'resolving' });
    }
    return err({ reason: 'not-found' });
  }
};

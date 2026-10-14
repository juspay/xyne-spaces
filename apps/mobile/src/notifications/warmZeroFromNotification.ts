import { queries } from '@/src/zero/queries';
import { shadowKeyFor, type ShadowEntry } from '@xyne/shared/utils';
import {
  getChannelConversationsQueryHash,
  getThreadConversationQueryHash,
} from '@xyne/shared/machines';

import { WARM_SHADOW_MAX_AGE_MS } from '@/src/services/chatCacheTypes';
import { lotusStorage } from '@/src/services/localStorage';
import { containsNotificationTarget, mmkvStorageAdapter } from '@/src/services/mmkvStorageAdapter';
import { executeFallbackQueries } from '@/src/services/zeroFallbackClient';
import { ZERO_CONNECTED_AT_KEY } from '@/src/utils/zeroConnectedHeartbeat';

const ZERO_CONNECTED_FRESHNESS_MS = 15_000;
const DEFAULT_WARM_BUDGET_MS = 22_000;

export type NotificationWarmScope = 'full' | 'chat';

export type NotificationWarmOptions = {
  budgetMs?: number;
  scope?: NotificationWarmScope;
};

async function readShadowLocal<T>(
  userID: string,
  queryName: string,
  args: unknown,
): Promise<ShadowEntry<T> | null> {
  const key = shadowKeyFor(userID, queryName, args);
  const raw = await mmkvStorageAdapter.readShadowValue(key);
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as ShadowEntry<T>;
  if (entry.savedAt && Date.now() - entry.savedAt > WARM_SHADOW_MAX_AGE_MS) {
    await mmkvStorageAdapter.removeShadowValue(key);
    return null;
  }
  if (!entry.data || !Array.isArray(entry.data)) return null;
  return entry;
}

async function writeShadowLocal<T>(
  userID: string,
  queryName: string,
  args: unknown,
  entry: ShadowEntry<T>,
): Promise<void> {
  const key = shadowKeyFor(userID, queryName, args);
  await mmkvStorageAdapter.writeShadowValue(key, { ...entry, savedAt: Date.now() });
}

/**
 * Minimal per-notification hydration target — pulled from the parsed FCM payload.
 * `channelId` is present for every message push; the other fields refine the
 * shape when it's a thread reply.
 */
export type WarmTarget = {
  channelId: string;
  isThread: boolean;
  isDm: boolean;
  messageId?: string;
  conversationId?: string;
  threadId?: string;
};

/**
 * Warming may only be skipped when the local cache can already land this exact
 * notification. Containment is decided by the cache's own definition so this
 * check can never drift from what the chat surfaces will actually paint.
 */
const hasCachedNotificationTarget = (target: WarmTarget): boolean => {
  const messageId = target.messageId?.trim();
  if (!messageId) return false;

  const kind = target.isThread ? 'thread' : 'channel';
  const id = target.isThread ? (target.threadId ?? target.conversationId) : target.channelId;
  if (!id) return false;

  return containsNotificationTarget(
    kind,
    mmkvStorageAdapter.readNotificationChatEntitySync(kind, id, messageId),
    messageId,
  );
};

/**
 * The subset of Zero's `context` that our queries actually read. Matches what
 * ZeroProvider passes as `context` when constructing Zero. `userID` is also
 * baked into shadow keys so multi-user MMKVs stay isolated.
 */
export type WarmUserContext = {
  userID: string;
  workspaceId: string;
  role: string;
  orgRole: string;
  memberId: string;
  schemaVersion: string;
};

type PreloadOutcome = {
  name: string;
  ok: boolean;
  ms: number;
  rowCount?: number;
  error?: string;
};

// MUST match features/activity/hooks/useActivityScreenModel.ts's PAGE_SIZE
// (currently 40). Warm args are canonical-JSON-hashed into the shadow key;
// any drift here yields a shadow miss on the activity screen.
const ACTIVITY_PAGE_SIZE = 40;

// Matches the chat screen's live query in features/chat/v2/hooks/useChannelMessages.ts
// so the warmed rows correspond to what the app subscribes to on open.
const CHANNEL_LATEST_LIMIT = 25;

const DM_LIST_PAGE_SIZE = 20;

type WarmJob = {
  name: string;
  queryName: string;
  shadowArgs: unknown;
  fallbackArgs: unknown;
  mergeExisting?: boolean;
  /**
   * Persist strategy for this job's HTTP fallback result.
   *   'shadow' (default) — writes into the shadow-cache key that
   *      useCachedQuery/useFallbackHydratedQuery consume on cold boot.
   *   'threadConversationEntity' — writes one workspace-scoped thread entity,
   *      keyed by conversationId. `threadConversationId` MUST be set. It is
   *      consumed by useMessages({kind:'thread', ...}) on app boot/open.
   *   'channelConversationEntity' — writes one workspace-scoped channel entity,
   *      keyed by channelId. `channelId` MUST be set. It is consumed by
   *      useChannelMessages; no shadow reader exists for this query on Lotus.
   */
  persistTarget?: 'shadow' | 'threadConversationEntity' | 'channelConversationEntity';
  threadConversationId?: string;
  channelId?: string;
};

function extractMaxUpdatedAt(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  let max = 0;
  for (const row of rows) {
    const val = (row as Record<string, unknown>)?.['updatedAt'];
    if (typeof val === 'number' && val > max) max = val;
  }
  return max;
}

function mergeById<T>(existing: T[], incoming: T[]): T[] {
  const map = new Map<unknown, T>();
  for (const item of existing) map.set((item as Record<string, unknown>)['id'], item);
  for (const item of incoming) map.set((item as Record<string, unknown>)['id'], item);
  return Array.from(map.values());
}

async function persistJobResult(
  userID: string,
  workspaceId: string,
  job: WarmJob,
  rows: unknown,
): Promise<PreloadOutcome> {
  if (job.persistTarget === 'threadConversationEntity') {
    return persistThreadConversationEntityJob(userID, workspaceId, job, rows);
  }
  if (job.persistTarget === 'channelConversationEntity') {
    return persistChannelConversationEntityJob(userID, workspaceId, job, rows);
  }
  const t0 = Date.now();
  try {
    const freshMax = extractMaxUpdatedAt(rows);
    let finalRows: unknown = rows;
    let finalWatermark = freshMax;
    if (job.mergeExisting) {
      const existing = await readShadowLocal(userID, job.queryName, job.shadowArgs);
      const existingRows = existing?.data?.[0];
      if (Array.isArray(existingRows) && Array.isArray(rows)) {
        finalRows = mergeById(existingRows, rows);
      }
      const existingWatermark = existing?.lastUpdatedAt ?? 0;
      finalWatermark = Math.max(existingWatermark, freshMax);
    }
    const rowCount = Array.isArray(finalRows)
      ? finalRows.length
      : finalRows === null || finalRows === undefined
        ? 0
        : 1;
    await writeShadowLocal(userID, job.queryName, job.shadowArgs, {
      data: [finalRows, { type: 'complete' }],
      lastUpdatedAt: finalWatermark,
    });
    return { name: job.name, ok: true, ms: Date.now() - t0, rowCount };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { name: job.name, ok: false, ms: Date.now() - t0, error: err };
  }
}

/**
 * Write one shared channel cache entity. This is the sole persist target for
 * the channelLatest-* warm query on Lotus — no shadow write is needed because
 * `useChannelMessages` reads its warm snapshot through the chat-cache adapter.
 *
 * Runs headless-safe without `init()` so it survives the FCM JS lifetime
 * ending before foreground persistence can run.
 */
async function persistChannelConversationEntityJob(
  userID: string,
  workspaceId: string,
  job: WarmJob,
  rows: unknown,
): Promise<PreloadOutcome> {
  const t0 = Date.now();
  const channelId = job.channelId;
  if (!channelId) {
    return {
      name: job.name,
      ok: false,
      ms: 0,
      error: 'channelId missing',
    };
  }
  if (!Array.isArray(rows)) {
    return { name: job.name, ok: true, ms: Date.now() - t0, rowCount: 0 };
  }
  try {
    mmkvStorageAdapter.writeChatEntityForUser(
      userID,
      workspaceId,
      'channel',
      channelId,
      rows,
      getChannelConversationsQueryHash({ userID }),
    );
    mmkvStorageAdapter.setWarmCacheDirty();
    return {
      name: job.name,
      ok: true,
      ms: Date.now() - t0,
      rowCount: rows.length,
    };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { name: job.name, ok: false, ms: Date.now() - t0, error: err };
  }
}

/**
 * Persist a `threadConversation` HTTP fallback result into its workspace-scoped
 * MMKV entity. This is the same storage location the query cache machine
 * hydrates from on app boot.
 *
 * Bypasses queryCacheActor entirely because this runs in the FCM headless JS
 * task, where the 2s persist debounce can outlive the JS lifetime.
 */
async function persistThreadConversationEntityJob(
  userID: string,
  workspaceId: string,
  job: WarmJob,
  rows: unknown,
): Promise<PreloadOutcome> {
  const t0 = Date.now();
  const conversationId = job.threadConversationId;
  if (!conversationId) {
    return {
      name: job.name,
      ok: false,
      ms: 0,
      error: 'threadConversationId missing',
    };
  }
  const wrapper = Array.isArray(rows) ? rows[0] : rows;
  if (!wrapper || typeof wrapper !== 'object') {
    return {
      name: job.name,
      ok: true,
      ms: Date.now() - t0,
      rowCount: 0,
    };
  }
  try {
    mmkvStorageAdapter.writeChatEntityForUser(
      userID,
      workspaceId,
      'thread',
      conversationId,
      wrapper,
      getThreadConversationQueryHash({ userID }),
    );
    mmkvStorageAdapter.setWarmCacheDirty();
    const messageCount = Array.isArray((wrapper as { messages?: unknown }).messages)
      ? (wrapper as { messages: unknown[] }).messages.length
      : 0;
    return {
      name: job.name,
      ok: true,
      ms: Date.now() - t0,
      rowCount: messageCount,
    };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { name: job.name, ok: false, ms: Date.now() - t0, error: err };
  }
}

/**
 * Warm the app's persistent MMKV shadow cache with the queries the app will
 * first render after a notification lands. Uses the HTTP fallback API — a
 * single batched request runs all queries server-side and returns rows over
 * plain JSON. Zero is NOT constructed here: no WS connect, no op-sqlite
 * hydration, no IVM materialization.
 *
 * Results are stored in "warm shadow" keys (name-based, unscoped by user-scope
 * prefix), which the JS-side hooks (`useCachedQuery`, `useFallbackHydratedQuery`)
 * consume on cold boot. This same key format is written by the iOS NSE in
 * Swift, so a single reader serves both platforms.
 *
 * For delta queries (`getUsersV2`, `userAllChannels`), the shadow key uses
 * empty args (matches what `InitialStateLoader` passes on foreground). The
 * writer reads the existing shadow, extracts a watermark from its stored rows,
 * fetches only rows newer than it, merges into the stored list, and writes
 * back — so each notification incrementally advances the merged snapshot.
 * A foreground tap can pass `scope: 'chat'` to hydrate only the destination
 * channel/thread; the default `scope: 'full'` keeps the background startup
 * warm unchanged.
 */
export async function warmZeroFromNotification(
  ctx: WarmUserContext,
  target: WarmTarget,
  options: NotificationWarmOptions = {},
): Promise<{
  totalMs: number;
  outcomes: PreloadOutcome[];
  budgetMs: number;
}> {
  const t0 = Date.now();
  const budgetMs = options.budgetMs ?? DEFAULT_WARM_BUDGET_MS;
  const scope = options.scope ?? 'full';

  // Skip if the main app is currently connected to Zero — the app is receiving
  // live updates over the websocket, so warming would just duplicate work.
  try {
    const stamp = lotusStorage.getString(ZERO_CONNECTED_AT_KEY);
    const connectedAt = stamp ? Number(stamp) : 0;
    const ageMs = connectedAt ? Date.now() - connectedAt : Number.POSITIVE_INFINITY;
    if (
      connectedAt &&
      ageMs < ZERO_CONNECTED_FRESHNESS_MS &&
      (!target.messageId || hasCachedNotificationTarget(target))
    ) {
      return { totalMs: Date.now() - t0, outcomes: [], budgetMs };
    }
  } catch {
    // MMKV read failure — proceed with warm.
  }

  const jobs: WarmJob[] = [];

  if (scope === 'full') {
    // Users roster — delta merge. Shadow key uses empty args.
    {
      const existing = await readShadowLocal(ctx.userID, 'getUsersV2', {});
      const watermark = existing?.lastUpdatedAt ?? 0;
      const deltaRequest = queries.getUsersV2({ updatedAt: watermark });
      jobs.push({
        name: `getUsersV2@${watermark}`,
        queryName: deltaRequest.query.queryName,
        shadowArgs: {},
        fallbackArgs: deltaRequest.args,
        mergeExisting: true,
      });
    }

    // All channels — delta merge.
    {
      const existing = await readShadowLocal(ctx.userID, 'userAllChannels', {});
      const watermark = existing?.lastUpdatedAt ?? 0;
      const deltaRequest = queries.userAllChannels({ updatedAt: watermark });
      jobs.push({
        name: `userAllChannels@${watermark}`,
        queryName: deltaRequest.query.queryName,
        shadowArgs: {},
        fallbackArgs: deltaRequest.args,
        mergeExisting: true,
      });
    }

    // Visible channels — full replace.
    {
      const request = queries.userVisibleChannelsV2();
      jobs.push({
        name: 'userVisibleChannelsV2',
        queryName: request.query.queryName,
        shadowArgs: request.args ?? {},
        fallbackArgs: request.args,
      });
    }

    // Activity feed — full replace.
    {
      const request = queries.userActivitiesPaginatedV2({
        limit: ACTIVITY_PAGE_SIZE,
        start: null,
        types: [],
        classification: undefined,
      });
      jobs.push({
        name: 'userActivitiesPaginatedV2',
        queryName: request.query.queryName,
        shadowArgs: request.args,
        fallbackArgs: request.args,
      });
    }

    // DM list first page — full replace. Only for DM/GROUP_DM notifications.
    // Args match useDmsPaginatedMessagesV2's first-page callsite so the
    // canonical shadow key is derived from the same request.
    if (target.isDm) {
      const request = queries.dmChannelsLatestMessagesPaginated({
        limit: DM_LIST_PAGE_SIZE,
        start: null,
        direction: 'forward',
      });
      jobs.push({
        name: 'dmChannelsLatestMessagesPaginated',
        queryName: request.query.queryName,
        shadowArgs: request.args,
        fallbackArgs: request.args,
      });
    }
  }

  // The notified channel's latest conversations.
  {
    const request = queries.channelLatestMultipleConversationsV3({
      channelId: target.channelId,
      isMember: true,
      limit: CHANNEL_LATEST_LIMIT,
    });
    jobs.push({
      name: `channelLatestMultipleConversationsV3:${target.channelId}`,
      queryName: request.query.queryName,
      shadowArgs: request.args,
      fallbackArgs: request.args,
      // Sole persist path: the channel entity. Lotus's useMessages reads it
      // through query-cache hydration; no shadow reader exists for this query.
      persistTarget: 'channelConversationEntity',
      channelId: target.channelId,
    });
  }

  // Thread reply notification → hydrate the thread reader.
  // Uses `threadConversationV2({conversationId})` — the same query
  // `useMessages({kind:'thread', ...})` subscribes to. Result is written to
  // its workspace-scoped thread entity, not the shadow cache.
  const threadKey = target.threadId ?? target.conversationId;
  if (target.isThread && threadKey) {
    const request = queries.threadConversationV2({
      conversationId: threadKey,
      channelId: target.channelId,
      isMember: true,
    });
    jobs.push({
      name: `threadConversation:${threadKey}`,
      queryName: request.query.queryName,
      shadowArgs: request.args,
      fallbackArgs: request.args,
      persistTarget: 'threadConversationEntity',
      threadConversationId: threadKey,
    });
  }

  // Fire ONE batched HTTP request for all queries. Server runs them in
  // parallel and returns rows keyed by query name.
  const fetchStart = Date.now();
  let fallbackResults: Array<{ name: string; data: unknown }> = [];
  let fallbackErr: string | undefined;
  try {
    const response = await Promise.race([
      executeFallbackQueries(jobs.map(j => ({ name: j.queryName, args: j.fallbackArgs }))),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('fallback batch timeout')), budgetMs);
      }),
    ]);
    fallbackResults = response.results;
  } catch (error) {
    fallbackErr = error instanceof Error ? error.message : String(error);
  }
  const fetchMs = Date.now() - fetchStart;

  if (fallbackErr) {
    const outcomes = jobs.map(j => ({
      name: j.name,
      ok: false,
      ms: fetchMs,
      error: fallbackErr,
    }));
    const totalMs = Date.now() - t0;
    return { totalMs, outcomes, budgetMs };
  }

  const outcomes: PreloadOutcome[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    // Positional first; fall back to by-name.
    const posMatch = fallbackResults[i];
    let rows: unknown;
    if (posMatch?.name === job.queryName) {
      rows = posMatch.data;
    } else {
      const byName = fallbackResults.find(r => r.name === job.queryName);
      rows = byName?.data;
    }
    if (rows === undefined) {
      outcomes.push({
        name: job.name,
        ok: false,
        ms: fetchMs,
        error: 'no result in fallback response',
      });
      continue;
    }
    const outcome = await persistJobResult(ctx.userID, ctx.workspaceId, job, rows);
    outcome.ms += fetchMs;
    outcomes.push(outcome);
  }

  const totalMs = Date.now() - t0;

  return { totalMs, outcomes, budgetMs };
}

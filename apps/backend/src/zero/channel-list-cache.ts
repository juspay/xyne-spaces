import { ChannelScopeType, ChannelVisibility, WorkspaceRole, type Context } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { readChannelListVersion } from './channel-list-cache-version';
import { zql } from './queries';

/**
 * Backend cache for the `userAllChannels` full load (XYNE-67041).
 *
 * The full load returns every channel the caller can see in the workspace — 130k rows
 * in the largest one — through a seq scan and a sort on every call. Almost all of
 * those rows are the same for every member, so the result is split the way the
 * channels read ACL (`ChannelsACL.canSelect`, packages/shared) defines visibility:
 *
 *   visible = shared(role) ∪ personal(user)
 *     shared   MEMBER / COMMUNITY_MEMBER: workspace channels that are not DM/GROUP_DM
 *              and are PUBLIC.  ADMIN / OWNER: workspace channels that are not DM/GROUP_DM.
 *     personal workspace channels the user is a participant of (same `participants`
 *              relationship the ACL uses).
 *
 * `shared` is cached per (workspace, role class) in this process; `personal` is
 * queried live on every call. Guests and any other role skip the cache, as does any
 * call with arguments (`updatedAt` deltas are already cheap).
 *
 * Freshness: every write to `channels` bumps a Redis version (per workspace from Zero
 * mutators and Prisma creates, global from other Prisma writes), and bumps it again
 * after CHANNEL_LIST_CACHE_REBUMP_MS so an entry rebuilt from a lagging read replica
 * in between is discarded too. Entries also expire after CHANNEL_LIST_CACHE_TTL_SEC as
 * a backstop for writes that don't go through either path. If Redis is unavailable the
 * cache is bypassed, never served blind.
 *
 * KEEP IN SYNC with ChannelsACL.canSelect: if channel visibility rules change, update
 * `sharedQuery` / `roleClass` here.
 */

type Row = Record<string, unknown>;
type RoleClass = 'public' | 'all';
type Entry = { version: string; builtAt: number; rows: readonly Row[]; ids: ReadonlySet<string> };
/** Runs a raw (non-ACL) ZQL query on the caller's provider and returns its rows. */
export type ChannelQueryRunner = (query: unknown, label: string) => Promise<unknown>;

const entries = new Map<string, Entry>(); // insertion order = LRU order
const builds = new Map<string, Promise<Entry>>();

function roleClass(ctx: Context): RoleClass | null {
  switch (ctx.role) {
    case WorkspaceRole.OWNER:
    case WorkspaceRole.ADMIN:
      return 'all';
    case WorkspaceRole.MEMBER:
    case WorkspaceRole.COMMUNITY_MEMBER:
      return 'public';
    default:
      return null; // guests and unknown roles: always use the normal query
  }
}

function hasNoArgs(args: unknown): boolean {
  if (args === undefined || args === null) return true;
  if (typeof args !== 'object' || Array.isArray(args)) return false;
  return Object.values(args as Record<string, unknown>).every(v => v === undefined);
}

function sharedQuery(workspaceId: string, cls: RoleClass) {
  const q = zql.channels
    .where('workspaceId', workspaceId)
    .where('scopeType', '!=', ChannelScopeType.DM)
    .where('scopeType', '!=', ChannelScopeType.GROUP_DM);
  return cls === 'public' ? q.where('visibility', ChannelVisibility.PUBLIC) : q;
}

function personalQuery(workspaceId: string, userId: string) {
  return zql.channels
    .where('workspaceId', workspaceId)
    .whereExists('participants', p => p.where('userId', userId));
}

function remember(key: string, entry: Entry): void {
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > config.channelListCache.maxEntries) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

async function build(key: string, workspaceId: string, cls: RoleClass, version: string, run: ChannelQueryRunner): Promise<Entry> {
  const started = Date.now();
  const rows = (await run(sharedQuery(workspaceId, cls), 'userAllChannels:shared')) as Row[];
  const entry: Entry = { version, builtAt: Date.now(), rows, ids: new Set(rows.map(r => r['id'] as string)) };
  if (rows.length <= config.channelListCache.maxRows) {
    remember(key, entry);
  }
  logger.info('channel_list_cache_build', { workspaceId, roleClass: cls, rows: rows.length, ms: Date.now() - started, stored: rows.length <= config.channelListCache.maxRows });
  return entry;
}

/**
 * Serve a `userAllChannels` full load from the cache, or return null when the call
 * isn't eligible (the caller then runs the normal ACL query).
 */
export async function serveUserAllChannelsFromCache(
  name: string,
  args: unknown,
  ctx: Context,
  run: ChannelQueryRunner,
): Promise<Row[] | null> {
  if (!config.channelListCache.enabled || name !== 'userAllChannels' || !hasNoArgs(args)) return null;
  const cls = roleClass(ctx);
  if (!cls || !ctx.workspaceId || !ctx.userID) return null;
  const workspaceId = ctx.workspaceId;

  let version: string;
  try {
    version = await readChannelListVersion(workspaceId);
  } catch (error) {
    logger.warn('channel_list_cache_version_unavailable', { error: error instanceof Error ? error.message : error });
    return null;
  }

  const key = `${workspaceId}:${cls}`;
  const cachedEntry = entries.get(key);
  let entry: Entry;
  if (cachedEntry && cachedEntry.version === version && Date.now() - cachedEntry.builtAt < config.channelListCache.ttlSec * 1000) {
    entry = cachedEntry;
    remember(key, entry); // refresh LRU position
  } else {
    const buildKey = `${key}@${version}`;
    let pending = builds.get(buildKey);
    if (!pending) {
      pending = build(key, workspaceId, cls, version, run).finally(() => builds.delete(buildKey));
      builds.set(buildKey, pending);
    }
    entry = await pending;
  }

  const personal = (await run(personalQuery(workspaceId, ctx.userID), 'userAllChannels:personal')) as Row[];
  const extra = personal.filter(r => !entry.ids.has(r['id'] as string));
  // Cached rows are shared between responses: callers must not mutate them.
  return extra.length ? [...entry.rows, ...extra] : [...entry.rows];
}

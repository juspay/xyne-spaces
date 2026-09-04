import { PassThrough } from 'stream';
import readline from 'readline';
import fetch from 'node-fetch';
import { WebClient, LogLevel } from '@slack/web-api';
import { ChannelRole } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { decrypt } from '@/services/encryptionService';
import { getStorageService } from '@/services/storage';
import { runAsServiceActor } from '@/database/tenant/context';
import { UserRepository } from '@/database/repositories/users';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { channelService } from '@/services/channelService';
import {
  findOrCreateUser,
  findOrCreateApp,
  ingestConversationSlack,
} from '@/migration/scripts/ingestConversationSlack';
import { bulkIngestConversationSlack } from '@/migration/scripts/bulkIngestConversationSlack';
import {
  transformMessage,
  collectRawFiles,
  fetchPinnedMessageTimestamps,
  isHumanMessage,
  type UserInfoCache,
} from '@/migration/slack/utils/extractConversation';
import type { SlackMessage } from '@/migration/slack/utils/extractConversation';
import { postMessage } from '@/migration/slack/utils/postMessage';
import { getBotConfigByWorkspaceId } from '@/migration/slack/slackMigrationBotConfig';
import { runWithSlackOfflineReference, type SlackOfflineReference } from '@/integrations/adapters/slack-webhook-tickets/utils/slackOfflineReference';
import { encryptStream, decryptStream, encryptBuffer, decryptBuffer } from './migrationCrypto';
import { getMigrationRuntimeConfig, MIGRATION_DEFAULTS } from './migrationRuntimeConfig';
import { ChannelInput, MigrationJob, MigrationType } from './types';

const PAGE = 1000;
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const PUBLIC_CHANNELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Route the Slack SDK's own diagnostics (esp. rate-limit "A rate limit was exceeded … retry in N seconds")
// into our logs, so a stalled collection can be attributed to throttling vs. a genuinely hung request.
const sdkLogger = {
  debug: () => undefined,
  info: (...m: unknown[]) => logger.info(`[SlackMigration:sdk] ${m.map(String).join(' ')}`),
  warn: (...m: unknown[]) => logger.warn(`[SlackMigration:sdk] ${m.map(String).join(' ')}`),
  error: (...m: unknown[]) => logger.error(`[SlackMigration:sdk] ${m.map(String).join(' ')}`),
  setLevel: () => undefined,
  getLevel: () => LogLevel.INFO,
  setName: () => undefined,
};
// Per-request timeout so a hung page aborts (SDK retries) instead of wedging collection.
const slackClient = (token: string, timeoutMs: number = MIGRATION_DEFAULTS.requestTimeoutMs) => new WebClient(token, { timeout: timeoutMs, logger: sdkLogger });

// Time a Slack call and warn (with method + context) when it runs long, so a stall points at the exact culprit.
async function timed<T>(label: string, ctx: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - start;
    if (ms >= 5000) logger.warn(`[SlackMigration] slow ${label}`, { ms, ...ctx });
    return out;
  } catch (e) {
    logger.warn(`[SlackMigration] ${label} errored`, { ms: Date.now() - start, ...ctx, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Slack-hosted file we can fetch with the user token; external/tombstoned/deleted have no bytes and stay metadata-only. */
const isDownloadableSlackFile = (f: any): boolean =>
  !!f?.id &&
  typeof f?.url_private === 'string' &&
  !f.is_external &&
  !f.external_type &&
  f.mode !== 'external' &&
  f.mode !== 'tombstone' &&
  !f.file_deleted;

const paths = {
  manifest: (p: string) => `${p}/manifest.json`,
  users: (p: string) => `${p}/users.json`,
  conversation: (p: string, id: string) => `${p}/conversations/${id}.jsonl`,
  pins: (p: string, id: string) => `${p}/pins/${id}.json`,
  usergroups: (p: string) => `${p}/usergroups.json`,
  channels: (p: string) => `${p}/channels.json`,
  file: (p: string, fileId: string) => `${p}/files/${fileId}`,
  publicChannelsCache: (root: string, teamId: string) => `${root}/_public-channels/${teamId}.json`,
};

export interface CollectedConversation { id: string; isMpim: boolean; members: string[]; }
export interface ChannelMeta { id: string; name: string; isPrivate: boolean; }

export interface DirUser { id: string; email?: string; real_name?: string; display_name?: string; is_bot?: boolean; deleted?: boolean; bot_id?: string; }

/** Errors meaning "token can no longer read this conversation" (deactivated/left) — skipped so one dead conversation
 *  doesn't fail the migration. Everything else (rate limit, network, auth) propagates and keeps the job resumable. */
const SKIPPABLE_CONVERSATION_ERRORS = new Set(['channel_not_found', 'not_in_channel']);
const slackErrorCode = (err: unknown): string | undefined => {
  const e = err as { data?: { error?: string }; message?: string };
  return e?.data?.error ?? e?.message?.replace(/^An API error occurred:\s*/, '');
};
const isSkippableConversationError = (err: unknown): boolean =>
  SKIPPABLE_CONVERSATION_ERRORS.has(slackErrorCode(err) ?? '');

/** Newest message time in a batch (Slack ts → Date), to place a new DM channel at its real spot. */
const newestMessageDate = (messages: SlackMessage[]): Date | undefined => {
  let maxTs = 0;
  for (const m of messages) {
    const t = parseFloat(m.externalId);
    if (t > maxTs) maxTs = t;
  }
  return maxTs > 0 ? new Date(maxTs * 1000) : undefined;
};

/** Convert a YYYY-MM-DD start date to a Slack `oldest` ts (epoch seconds) for conversations.history. */
const oldestFromStartDate = (startDate?: string): string | undefined => {
  if (!startDate) return undefined;
  const ms = Date.parse(startDate);
  return Number.isNaN(ms) ? undefined : String(Math.floor(ms / 1000));
};

/**
 * Self-serve pipeline engine: collection streams Slack → GCS (never buffered), loading reuses
 * `transformMessage` + `ingestConversationSlack`. TODO: for full identity fidelity share code with
 * the validated `ingestDumpLocal` loader — see PRD §5.11.
 */
export class SlackMigrationEngine {
  /** Dedicated migration bucket isolated from app data; no fallback (fail loudly if unset).
   *  Lazy so API-only pods that never run a job don't trip it. */
  private get storage() {
    const bucket = config.gcs.migrationBucketName;
    if (!bucket) {
      throw new Error('MIGRATION_GCS_BUCKET is not configured — self-serve migration requires a dedicated bucket');
    }
    return getStorageService(bucket);
  }

  // Parallel ingest: each worker builds the offline reference + manifest ONCE per migration and reuses them across
  // every conversation it drains (instead of once per conversation). Bounded by TTL; entries fall out after a job ends.
  private readonly offlineRefCache = new Map<string, { at: number; ref: SlackOfflineReference }>();
  private readonly manifestCache = new Map<string, { at: number; convs: CollectedConversation[] }>();
  private static readonly WORKER_CACHE_TTL_MS = 30 * 60 * 1000;

  async getOfflineReference(migrationId: string, gcsPrefix: string): Promise<SlackOfflineReference> {
    let hit = this.offlineRefCache.get(migrationId);
    if (!hit || Date.now() - hit.at >= SlackMigrationEngine.WORKER_CACHE_TTL_MS) {
      hit = { at: Date.now(), ref: await this.buildOfflineReference(gcsPrefix) };
      this.offlineRefCache.set(migrationId, hit);
      this.evictStaleCache(this.offlineRefCache);
    }
    // Fresh shallow clone per call: concurrent loadConversation calls share the read-only users/groups/channels maps
    // but each gets its own object so they don't race on the mutable `createUser` field loadConversation assigns.
    return { users: hit.ref.users, groups: hit.ref.groups, channels: hit.ref.channels };
  }

  async getManifest(migrationId: string, gcsPrefix: string): Promise<CollectedConversation[]> {
    let hit = this.manifestCache.get(migrationId);
    if (!hit || Date.now() - hit.at >= SlackMigrationEngine.WORKER_CACHE_TTL_MS) {
      hit = { at: Date.now(), convs: await this.readManifest(gcsPrefix) };
      this.manifestCache.set(migrationId, hit);
      this.evictStaleCache(this.manifestCache);
    }
    return hit.convs;
  }

  async getManifestConversation(migrationId: string, gcsPrefix: string, conversationId: string): Promise<CollectedConversation | undefined> {
    return (await this.getManifest(migrationId, gcsPrefix)).find((c) => c.id === conversationId);
  }

  private evictStaleCache<T extends { at: number }>(cache: Map<string, T>): void {
    const cutoff = Date.now() - SlackMigrationEngine.WORKER_CACHE_TTL_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }

  async collectDirectory(token: string, gcsPrefix: string): Promise<Record<string, DirUser>> {
    const cfg = await getMigrationRuntimeConfig();
    const client = slackClient(token, cfg.requestTimeoutMs);
    const users: Record<string, DirUser> = {};
    let cursor: string | undefined;
    do {
      const r = await client.users.list({ limit: 1000, cursor }); // large page → fewer requests, gentler on Tier-2 rate limit
      for (const u of r.members ?? []) {
        const p = (u as { profile?: { email?: string; real_name?: string; display_name?: string; bot_id?: string } }).profile ?? {};
        users[(u as { id: string }).id] = {
          id: (u as { id: string }).id, email: p.email, real_name: p.real_name,
          display_name: p.display_name, is_bot: (u as { is_bot?: boolean }).is_bot ?? false,
          deleted: (u as { deleted?: boolean }).deleted ?? false, bot_id: p.bot_id,
        };
      }
      cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
      if (cursor && cfg.listDelayMs > 0) await sleep(cfg.listDelayMs);
    } while (cursor);
    await this.writeJson(paths.users(gcsPrefix), users);
    return users;
  }

  async listConversations(token: string, type: MigrationType, channel?: ChannelInput): Promise<CollectedConversation[]> {
    const cfg = await getMigrationRuntimeConfig();
    if (type === MigrationType.CHANNEL) {
      if (!channel) return [];
      // Real Slack membership → synced as Xyne participants at ingest.
      const members = await this.fetchChannelMembers(token, channel.slackChannelId);
      return [{ id: channel.slackChannelId, isMpim: false, members }];
    }
    const client = slackClient(token, cfg.requestTimeoutMs);
    const out: CollectedConversation[] = [];
    let cursor: string | undefined;
    do {
      const r = await client.conversations.list({ types: 'im,mpim', limit: 1000, cursor });
      for (const c of r.channels ?? []) {
        const cc = c as { id: string; is_mpim?: boolean; user?: string };
        // im carries the other user in `.user`; mpim (group DM) needs members fetched, else the loader drops it.
        const members = cc.is_mpim ? await this.fetchChannelMembers(token, cc.id) : (cc.user ? [cc.user] : []);
        out.push({ id: cc.id, isMpim: !!cc.is_mpim, members });
      }
      cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
      if (cursor && cfg.listDelayMs > 0) await sleep(cfg.listDelayMs);
    } while (cursor);
    return out;
  }

  /** All member Slack user ids of a channel (paginated). */
  private async fetchChannelMembers(token: string, channelId: string): Promise<string[]> {
    const cfg = await getMigrationRuntimeConfig();
    const client = slackClient(token, cfg.requestTimeoutMs);
    const members: string[] = [];
    let cursor: string | undefined;
    try {
      do {
        const r = await client.conversations.members({ channel: channelId, limit: 1000, cursor });
        members.push(...(r.members ?? []));
        cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
        if (cursor && cfg.pageDelayMs > 0) await sleep(cfg.pageDelayMs);
      } while (cursor);
    } catch (e) {
      logger.warn('[SlackMigration] conversations.members failed — channel participants may be incomplete', {
        channelId, error: e instanceof Error ? e.message : String(e),
      });
    }
    return members;
  }

  async collectConversation(token: string, conv: CollectedConversation, gcsPrefix: string, startDate?: string, onProgress?: (p: { messages: number; newestTs: number; oldestTs: number }) => Promise<void>): Promise<{ messages: number; outcome: 'ok' | 'truncated' | 'skipped'; reason?: string }> {
    const cfg = await getMigrationRuntimeConfig();
    const client = slackClient(token, cfg.requestTimeoutMs);
    const oldest = oldestFromStartDate(startDate);
    const pinned = await fetchPinnedMessageTimestamps(client, conv.id).catch(() => new Set<string>());
    const stream = new PassThrough();
    const done = this.storage.uploadStreamToPath(encryptStream(stream), {
      path: paths.conversation(gcsPrefix, conv.id), contentType: 'application/octet-stream', chunkSize: UPLOAD_CHUNK_SIZE,
    });
    let count = 0;
    let outcome: 'ok' | 'truncated' | 'skipped' = 'ok';
    let reason: string | undefined;
    // history pages newest → oldest: newestTs fixes after page 1, oldestTs marches toward window start — drives the progress bar.
    let newestTs = 0;
    let oldestTs = Infinity;
    let cursor: string | undefined;
    let page = 0;
    logger.debug('[SlackMigration] collecting conversation', { convId: conv.id, isMpim: conv.isMpim, members: conv.members.length });
    try {
      do {
        const r = await timed('conversations.history', { convId: conv.id, page: page + 1, cursor: !!cursor }, () =>
          client.conversations.history({ channel: conv.id, limit: PAGE, cursor, inclusive: true, oldest }));
        page += 1;
        logger.debug('[SlackMigration] history page', { convId: conv.id, page, messages: (r.messages ?? []).length, running: count });
        for (const m of r.messages ?? []) {
          await this.prefetchFiles(token, m, gcsPrefix);
          if (((m as { reply_count?: number }).reply_count ?? 0) > 0 && (m as { ts?: string }).ts) {
            const replies = await this.fetchReplies(token, conv.id, (m as { ts: string }).ts, gcsPrefix);
            if (replies.length) (m as { _replies?: unknown[] })._replies = replies;
          }
          const ts = parseFloat((m as { ts?: string }).ts ?? '0');
          if (ts > newestTs) newestTs = ts;
          if (ts > 0 && ts < oldestTs) oldestTs = ts;
          stream.write(`${JSON.stringify(m)}\n`);
          count += 1;
        }
        if (onProgress) await onProgress({ messages: count, newestTs, oldestTs: oldestTs === Infinity ? 0 : oldestTs }); // live per-page progress
        cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
        if (cursor && cfg.pageDelayMs > 0) await sleep(cfg.pageDelayMs);
      } while (cursor);
    } catch (err) {
      if (!isSkippableConversationError(err)) throw err;
      const code = slackErrorCode(err);
      if (code === 'channel_not_found') {
        outcome = 'skipped';
        reason = 'Channel not found on Slack (deleted or inaccessible).';
      } else {
        // not_in_channel: mid-collection ⇒ truncated (keep what we have); before any page ⇒ skipped.
        outcome = count > 0 ? 'truncated' : 'skipped';
        reason = count > 0
          ? `Lost access after ~${count} messages (bot removed from the channel).`
          : 'Bot is not in the channel.';
      }
      logger.warn('[SlackMigration] conversation not fully collected', { conversationId: conv.id, error: code, outcome });
    } finally {
      stream.end();
    }
    await done;
    await this.writeJson(paths.pins(gcsPrefix, conv.id), [...pinned]);
    return { messages: count, outcome, reason };
  }

  /** Reference dumps so ingestion resolves users/groups/channels offline (no Slack). */
  async collectUsergroups(token: string, gcsPrefix: string): Promise<void> {
    const cfg = await getMigrationRuntimeConfig();
    const groups: Record<string, unknown> = {};
    try {
      const r = await slackClient(token, cfg.requestTimeoutMs).usergroups.list({ include_users: true });
      for (const g of r.usergroups ?? []) groups[(g as { id: string }).id] = g;
    } catch (e) {
      logger.warn('[SlackMigration] usergroups.list failed — mentions of usergroups will be unresolved', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await this.writeJson(paths.usergroups(gcsPrefix), groups);
  }

  async collectChannels(token: string, gcsPrefix: string, teamId: string): Promise<void> {
    const cfg = await getMigrationRuntimeConfig();
    const client = slackClient(token, cfg.requestTimeoutMs);
    const channels: Record<string, ChannelMeta> = {};

    try {
      let cursor: string | undefined;
      do {
        const r = await client.conversations.list({ types: 'private_channel', limit: 1000, cursor, exclude_archived: false });
        for (const c of r.channels ?? []) {
          const cc = c as { id: string; name?: string };
          channels[cc.id] = { id: cc.id, name: cc.name || cc.id, isPrivate: true };
        }
        cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
        if (cursor && cfg.listDelayMs > 0) await sleep(cfg.listDelayMs);
      } while (cursor);
    } catch (e) {
      logger.warn('[SlackMigration] conversations.list (private channels) failed — some channel mentions may be unresolved', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const root = gcsPrefix.replace(/\/[^/]+$/, '');
    const publicChannels = await this.publicChannels(client, paths.publicChannelsCache(root, teamId), teamId);
    for (const [id, meta] of Object.entries(publicChannels)) channels[id] = meta;

    await this.writeJson(paths.channels(gcsPrefix), channels);
  }

  private async publicChannels(client: WebClient, cachePath: string, teamId: string): Promise<Record<string, ChannelMeta>> {
    const cfg = await getMigrationRuntimeConfig();
    const cached = (await this.storage.fileExists(cachePath))
      ? await this.readJson<{ fetchedAt: number; channels: Record<string, ChannelMeta> }>(cachePath).catch(() => null)
      : null;
    if (cached && Date.now() - cached.fetchedAt < PUBLIC_CHANNELS_CACHE_TTL_MS) {
      logger.info('[SlackMigration] reusing cached public channels', { teamId, count: Object.keys(cached.channels).length });
      return cached.channels;
    }
    const channels: Record<string, ChannelMeta> = {};
    let cursor: string | undefined;
    let complete = false;
    try {
      do {
        const r = await client.conversations.list({ types: 'public_channel', limit: 1000, cursor, exclude_archived: false });
        for (const c of r.channels ?? []) {
          const cc = c as { id: string; name?: string };
          channels[cc.id] = { id: cc.id, name: cc.name || cc.id, isPrivate: false };
        }
        cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
        if (cursor && cfg.listDelayMs > 0) await sleep(cfg.listDelayMs);
      } while (cursor);
      complete = true;
    } catch (e) {
      logger.warn('[SlackMigration] conversations.list (public channels) failed — using stale cache if present', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (complete) {
      logger.info('[SlackMigration] refreshed public channels cache', { teamId, count: Object.keys(channels).length });
      await this.writeJson(cachePath, { fetchedAt: Date.now(), channels }).catch(() => undefined);
      return channels;
    }
    return cached?.channels ?? channels;
  }

  /** Stream every Slack-hosted file on a message (top-level or reply) → storage, in bounded-concurrency batches. */
  private async prefetchFiles(token: string, m: unknown, gcsPrefix: string): Promise<void> {
    const cfg = await getMigrationRuntimeConfig();
    const files = collectRawFiles(m).filter((f) => isDownloadableSlackFile(f));
    for (let i = 0; i < files.length; i += cfg.fileConcurrency) {
      await Promise.all(
        files.slice(i, i + cfg.fileConcurrency).map(async (f) => {
          const uri = await this.streamFileToGcs(token, f, gcsPrefix);
          if (uri) f.prefetchedStoragePath = uri;
        }),
      );
    }
  }

  /** Fetch all replies of a thread (excluding the parent) and prefetch their files. */
  private async fetchReplies(token: string, channelId: string, ts: string, gcsPrefix: string): Promise<unknown[]> {
    const cfg = await getMigrationRuntimeConfig();
    const client = slackClient(token, cfg.requestTimeoutMs);
    const replies: unknown[] = [];
    let cursor: string | undefined;
    do {
      const r = await timed('conversations.replies', { channelId, ts }, () =>
        client.conversations.replies({ channel: channelId, ts, limit: PAGE, cursor }));
      for (const m of r.messages ?? []) {
        if ((m as { ts?: string }).ts === ts) continue; // conversations.replies includes the parent first
        await this.prefetchFiles(token, m, gcsPrefix);
        replies.push(m);
      }
      cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
      if (cursor && cfg.pageDelayMs > 0) await sleep(cfg.pageDelayMs);
    } while (cursor);
    return replies;
  }

  /** Stream one Slack-hosted file straight to storage (never buffered); returns its storage path. */
  private async streamFileToGcs(token: string, file: { id: string; url_private: string; url_private_download?: string; mimetype?: string }, gcsPrefix: string): Promise<string | undefined> {
    const cfg = await getMigrationRuntimeConfig();
    const dest = paths.file(gcsPrefix, file.id);
    const url = file.url_private_download || file.url_private;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.fileTimeoutMs);
    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Xyne-Spaces-Backend/1.0' },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        // Skip rather than fail the conversation — a 403 (missing files:read) or dead file shouldn't abort the migration.
        logger.warn('[SlackMigration] attachment download failed — skipping', {
          id: file.id, status: res.status, statusText: res.statusText,
        });
        return undefined;
      }
      const body = res.body as NodeJS.ReadableStream;
      // node-fetch emits the abort/socket error on the body stream out-of-band; without a listener it becomes an
      // uncaught exception that can crash the pod. Handle it here so a slow/aborted download is contained, not fatal.
      body.on('error', (err: unknown) => logger.warn('[SlackMigration] attachment stream aborted — skipping', {
        id: file.id, error: err instanceof Error ? err.message : String(err),
      }));
      await this.storage.uploadStreamToPath(encryptStream(body), {
        path: dest,
        contentType: 'application/octet-stream',
      });
      const ms = Date.now() - startedAt;
      if (ms >= 5000) logger.warn('[SlackMigration] slow attachment download', { id: file.id, ms });
      // Full gs://bucket/key URI so ingestion reads the migration bucket, not the default attachment storage.
      return this.storage.buildStorageUri(dest);
    } catch (e) {
      logger.warn('[SlackMigration] attachment download errored — skipping', {
        id: file.id, error: e instanceof Error ? e.message : String(e),
      });
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Build the offline Slack reference (users/groups/channels) from the collected dumps. */
  async buildOfflineReference(gcsPrefix: string): Promise<SlackOfflineReference> {
    const [usersRec, groupsRec, channelsRec] = await Promise.all([
      this.readJson<Record<string, DirUser>>(paths.users(gcsPrefix)).catch(() => ({} as Record<string, DirUser>)),
      this.readJson<Record<string, unknown>>(paths.usergroups(gcsPrefix)).catch(() => ({} as Record<string, unknown>)),
      this.readJson<Record<string, { id: string; name: string; isPrivate: boolean }>>(paths.channels(gcsPrefix)).catch(() => ({} as Record<string, { id: string; name: string; isPrivate: boolean }>)),
    ]);
    return {
      users: new Map(Object.entries(usersRec).map(([id, u]) => [id, {
        id, is_bot: u.is_bot, deleted: u.deleted,
        profile: { email: u.email, real_name: u.real_name, display_name: u.display_name, bot_id: u.bot_id },
      }])),
      groups: new Map(Object.entries(groupsRec)),
      channels: new Map(Object.entries(channelsRec)),
    };
  }

  async loadConversation(job: MigrationJob, conv: CollectedConversation, ref: SlackOfflineReference, onProgress?: () => void): Promise<{ ingested: number; failed: number }> {
    const cfg = await getMigrationRuntimeConfig();
    return runAsServiceActor('slack-migration', job.workspaceId, async () => {
      const userRepo = new UserRepository();
      const channelRepo = new ChannelRepository();
      const participantRepo = new ChannelParticipantRepository();
      const cache: UserInfoCache = new Map();
      const provCache = new Map<string, { id: string; isDeactivated: boolean }>();

      const resolve = async (slackId: string): Promise<string | undefined> => {
        const u = ref.users.get(slackId) as { profile?: { email?: string; real_name?: string; display_name?: string }; is_bot?: boolean; deleted?: boolean } | undefined;
        const email = u?.profile?.email;
        if (!email || u?.is_bot) return undefined;
        const name = u?.profile?.display_name || u?.profile?.real_name || email;
        const id = await findOrCreateUser(email, name, !!u?.deleted, userRepo, provCache, job.workspaceId);
        if (id) cache.set(slackId, { userId: id, userEmail: email, userName: name, isBot: false });
        return id ?? undefined;
      };

      // Let the offline resolver create a mentioned user from their dumped email, so the mention
      // links to a real Xyne user even if they never posted / aren't a member.
      ref.createUser = async (email, name, isDeactivated) => {
        try { return await findOrCreateUser(email, name, isDeactivated, userRepo, provCache, job.workspaceId); }
        catch { return undefined; }
      };

      const isChannel = job.type === MigrationType.CHANNEL;
      // Self-DM ("notes to self") has only the owner as member — no "other" side, so otherIds resolution would wrongly drop it.
      const isSelfDm = !isChannel && conv.members.length > 0 && conv.members.every((m) => m === job.ownerSlackId);

      // DM: resolve both sides up front (bail if we can't). Channel: ingests into the pre-selected Xyne channel (resolved after empty check).
      let dmOwnerId: string | undefined;
      const dmOtherIds: string[] = [];
      if (isChannel) {
        if (!job.channelInput?.xyneChannelId) return { ingested: 0, failed: 0 };
      } else {
        dmOwnerId = job.ownerSlackId ? await resolve(job.ownerSlackId) : undefined;
        if (!dmOwnerId) return { ingested: 0, failed: 0 };
        if (!isSelfDm) {
          for (const m of conv.members) if (m !== job.ownerSlackId) { const id = await resolve(m); if (id) dmOtherIds.push(id); }
          if (dmOtherIds.length === 0) return { ingested: 0, failed: 0 };
        }
      }

      const pinnedTs = new Set(await this.readJson<string[]>(paths.pins(job.gcsPrefix, conv.id)).catch(() => []));

      // Transform with the offline reference active so mentions, author lookups and usergroup import all resolve from the dumps, never Slack.
      const stream = await this.storage.createReadStream(paths.conversation(job.gcsPrefix, conv.id));
      const rl = readline.createInterface({ input: decryptStream(stream), crlfDelay: Infinity });
      const messages: SlackMessage[] = await runWithSlackOfflineReference(ref, async () => {
        const out: SlackMessage[] = [];
        for await (const line of rl) {
          if (!line.trim()) continue;
          let raw: unknown;
          try { raw = JSON.parse(line); } catch { continue; }
          // Drop Slack system messages ("X joined the channel", topic changes) and env-ignored bots,
          // matching the existing /sync flow (isHumanMessage); real bot content is still kept.
          if (!isHumanMessage(raw, 'channel', [], true)) continue;
          out.push(await transformMessage(raw as never, (raw as { _replies?: never[] })._replies, cache, true, true, true, pinnedTs, job.workspaceId, ''));
        }
        return out;
      });
      if (messages.length === 0) return { ingested: 0, failed: 0 };

      // Channel → the requester's chosen Xyne channel. DM → find/create it (only now we know it has messages, so an empty DM never pins to the top).
      const channelId = isChannel
        ? job.channelInput!.xyneChannelId
        : isSelfDm
          ? await channelService.ensureSelfDmExists(dmOwnerId!, job.workspaceId) // canonical self-DM (same as login)
          : await channelRepo.findOrCreateDMChannel(dmOwnerId!, dmOtherIds, participantRepo, job.workspaceId);

      if (isChannel) {
        // Slack channel creator → Xyne ADMIN (matches /sync). First, because the member loop's
        // default-role addParticipant returns existing participants unchanged, so the creator stays ADMIN.
        if (job.slackChannelCreator) {
          const creatorId = await resolve(job.slackChannelCreator);
          if (creatorId) await participantRepo.addParticipant(channelId, creatorId, ChannelRole.ADMIN).catch(() => undefined);
        }
        // Sync real Slack members (captured at collection) as participants — humans via the user dump, bots as app users. All offline.
        const botCache: UserInfoCache = new Map();
        for (const slackId of conv.members) {
          const u = ref.users.get(slackId) as { is_bot?: boolean; profile?: { real_name?: string; display_name?: string; bot_id?: string } } | undefined;
          let participantId: string | undefined;
          if (u?.is_bot && u.profile?.bot_id) {
            const botName = u.profile.display_name || u.profile.real_name || 'bot';
            participantId = await findOrCreateApp(botName, u.profile.bot_id, botCache, slackId, job.workspaceId).catch(() => undefined);
          } else {
            participantId = await resolve(slackId);
          }
          if (participantId) await participantRepo.addParticipant(channelId, participantId).catch(() => undefined);
        }
      } else {
        // Place the new DM at its real last-message time so it never jumps to the top.
        const newest = newestMessageDate(messages);
        if (newest) await channelRepo.setLastActivity(channelId, newest);
      }

      const ingestInput = {
        slackMessages: messages,
        externalSourceName: `${isChannel ? 'channelMigration' : 'dmMigration'}-${channelId}`,
        channelId,
        workspaceId: job.workspaceId,
        botToken: 'slack-migration-offline',
        interMessageDelayMs: cfg.messageDelayMs,
        onProgress,
      };
      // Opt-in bulk path (createMany) — off by default; A/B against the per-message path before trusting it.
      const ingestResult = cfg.bulk
        ? await bulkIngestConversationSlack(ingestInput)
        : await ingestConversationSlack(ingestInput);
      await channelRepo.recalculateLastActivityFromMessages(channelId);
      return { ingested: messages.length, failed: ingestResult.errorDetails?.length ?? 0 };
    });
  }

  /** Opt-in: post a "migrated to Xyne Spaces" notice back into Slack via the central bot token
   *  (the per-job token is already dropped by ingest time). */
  async announceMigration(job: MigrationJob): Promise<void> {
    if (job.type !== MigrationType.CHANNEL || !job.channelInput?.announceInSlack) return;
    const wsConfig = getBotConfigByWorkspaceId(job.workspaceId);
    if (!wsConfig.notificationsEnabled) return;
    const link = `<https://spaces.xyne.juspay.net/${job.workspaceId}/chat/dir/${job.channelInput.xyneChannelId}|Xyne Spaces>`;
    let text = `<!channel> This Channel has been migrated to ${link}. Please move your conversations there only this channel will be soon archived.`;
    if (wsConfig.migrationFinalMessage) text += `\n${wsConfig.migrationFinalMessage}`;
    await postMessage({
      channelId: job.channelInput.slackChannelId,
      text,
      botToken: wsConfig.slackBotToken,
    });
  }

  async deletePrefix(prefix: string): Promise<void> {
    // StorageService has no prefix-delete; enumerate and delete each object.
    const files = await this.storage.listFiles(prefix);
    for (const f of files) {
      await this.storage.deleteFile(f.name).catch((e: unknown) =>
        logger.warn('[SlackMigration] failed to delete object during cleanup', {
          name: f.name, error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  decryptToken(job: MigrationJob): string {
    if (!job.encryptedToken) throw new Error('migration token missing');
    return decrypt(job.encryptedToken);
  }

  writeManifest(gcsPrefix: string, conversations: CollectedConversation[]): Promise<void> {
    return this.writeJson(paths.manifest(gcsPrefix), conversations);
  }

  readManifest(gcsPrefix: string): Promise<CollectedConversation[]> {
    return this.readJson<CollectedConversation[]>(paths.manifest(gcsPrefix));
  }

  /** Light read of the collected users dump (no Slack) — used to label skipped/truncated conversations for the UI. */
  readDirectory(gcsPrefix: string): Promise<Record<string, DirUser>> {
    return this.readJson<Record<string, DirUser>>(paths.users(gcsPrefix)).catch(() => ({} as Record<string, DirUser>));
  }

  manifestExists(gcsPrefix: string): Promise<boolean> {
    return this.storage.fileExists(paths.manifest(gcsPrefix));
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    const encrypted = encryptBuffer(Buffer.from(JSON.stringify(data)));
    await this.storage.uploadFileV2(encrypted, { path, contentType: 'application/octet-stream' });
  }

  private async readJson<T>(path: string): Promise<T> {
    const stream = await this.storage.createReadStream(path);
    const chunks: Buffer[] = [];
    for await (const c of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
    const plain = decryptBuffer(Buffer.concat(chunks));
    return JSON.parse(plain.toString('utf8')) as T;
  }
}

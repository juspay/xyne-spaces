import { PassThrough } from 'stream';
import readline from 'readline';
import fetch from 'node-fetch';
import { WebClient } from '@slack/web-api';
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
import {
  transformMessage,
  collectRawFiles,
  fetchPinnedMessageTimestamps,
  type UserInfoCache,
} from '@/migration/slack/utils/extractConversation';
import type { SlackMessage } from '@/migration/slack/utils/extractConversation';
import { postMessage } from '@/migration/slack/utils/postMessage';
import { getBotConfigByWorkspaceId } from '@/migration/slack/slackMigrationBotConfig';
import { runWithSlackOfflineReference, type SlackOfflineReference } from '@/integrations/adapters/slack-webhook-tickets/utils/slackOfflineReference';
import { encryptStream, decryptStream, encryptBuffer, decryptBuffer } from './migrationCrypto';
import { ChannelInput, MigrationJob, MigrationType } from './types';

const PAGE = 200;
// Timing knobs (validated in config/env.ts): pageDelayMs (throttle paged Slack calls),
// fileTimeoutMs (per-attachment), requestTimeoutMs (per Slack request), ingestMessageDelayMs (per-message DB/Vespa upper bound).
const PAGE_DELAY_MS = config.slackMigration.pageDelayMs;
const FILE_TIMEOUT_MS = config.slackMigration.fileTimeoutMs;
const REQUEST_TIMEOUT_MS = config.slackMigration.requestTimeoutMs;
const INGEST_MESSAGE_DELAY_MS = config.slackMigration.ingestMessageDelayMs;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-request timeout so a hung page aborts (SDK retries) instead of wedging collection.
const slackClient = (token: string) => new WebClient(token, { timeout: REQUEST_TIMEOUT_MS });

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
};

export interface CollectedConversation { id: string; isMpim: boolean; members: string[]; }

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

  async collectDirectory(token: string, gcsPrefix: string): Promise<Record<string, DirUser>> {
    const client = slackClient(token);
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
      if (cursor && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
    } while (cursor);
    await this.writeJson(paths.users(gcsPrefix), users);
    return users;
  }

  async listConversations(token: string, type: MigrationType, channel?: ChannelInput): Promise<CollectedConversation[]> {
    if (type === MigrationType.CHANNEL) {
      if (!channel) return [];
      // Real Slack membership → synced as Xyne participants at ingest.
      const members = await this.fetchChannelMembers(token, channel.slackChannelId);
      return [{ id: channel.slackChannelId, isMpim: false, members }];
    }
    const client = slackClient(token);
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
      if (cursor && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
    } while (cursor);
    return out;
  }

  /** All member Slack user ids of a channel (paginated). */
  private async fetchChannelMembers(token: string, channelId: string): Promise<string[]> {
    const client = slackClient(token);
    const members: string[] = [];
    let cursor: string | undefined;
    try {
      do {
        const r = await client.conversations.members({ channel: channelId, limit: 1000, cursor });
        members.push(...(r.members ?? []));
        cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
        if (cursor && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
      } while (cursor);
    } catch (e) {
      logger.warn('[SlackMigration] conversations.members failed — channel participants may be incomplete', {
        channelId, error: e instanceof Error ? e.message : String(e),
      });
    }
    return members;
  }

  async collectConversation(token: string, conv: CollectedConversation, gcsPrefix: string, startDate?: string, onProgress?: (p: { messages: number; newestTs: number; oldestTs: number }) => Promise<void>): Promise<number> {
    const client = slackClient(token);
    const oldest = oldestFromStartDate(startDate);
    const pinned = await fetchPinnedMessageTimestamps(client, conv.id).catch(() => new Set<string>());
    const stream = new PassThrough();
    const done = this.storage.uploadStreamToPath(encryptStream(stream), {
      path: paths.conversation(gcsPrefix, conv.id), contentType: 'application/octet-stream',
    });
    let count = 0;
    // history pages newest → oldest: newestTs fixes after page 1, oldestTs marches toward window start — drives the progress bar.
    let newestTs = 0;
    let oldestTs = Infinity;
    let cursor: string | undefined;
    try {
      do {
        const r = await client.conversations.history({ channel: conv.id, limit: PAGE, cursor, inclusive: true, oldest });
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
        if (cursor && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
      } while (cursor);
    } catch (err) {
      if (!isSkippableConversationError(err)) throw err;
      logger.warn('[SlackMigration] skipping inaccessible conversation', {
        conversationId: conv.id, error: slackErrorCode(err),
      });
    } finally {
      stream.end();
    }
    await done;
    await this.writeJson(paths.pins(gcsPrefix, conv.id), [...pinned]);
    return count;
  }

  /** Reference dumps so ingestion resolves users/groups/channels offline (no Slack). */
  async collectUsergroups(token: string, gcsPrefix: string): Promise<void> {
    const groups: Record<string, unknown> = {};
    try {
      const r = await slackClient(token).usergroups.list({ include_users: true });
      for (const g of r.usergroups ?? []) groups[(g as { id: string }).id] = g;
    } catch (e) {
      logger.warn('[SlackMigration] usergroups.list failed — mentions of usergroups will be unresolved', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await this.writeJson(paths.usergroups(gcsPrefix), groups);
  }

  async collectChannels(token: string, gcsPrefix: string): Promise<void> {
    const client = slackClient(token);
    const channels: Record<string, { id: string; name: string; isPrivate: boolean }> = {};
    let cursor: string | undefined;
    try {
      do {
        const r = await client.conversations.list({ types: 'public_channel,private_channel', limit: 1000, cursor, exclude_archived: false });
        for (const c of r.channels ?? []) {
          const cc = c as { id: string; name?: string; is_private?: boolean };
          channels[cc.id] = { id: cc.id, name: cc.name || cc.id, isPrivate: !!cc.is_private };
        }
        cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
        if (cursor && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
      } while (cursor);
    } catch (e) {
      logger.warn('[SlackMigration] conversations.list (channels) failed — channel mentions may be unresolved', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await this.writeJson(paths.channels(gcsPrefix), channels);
  }

  /** Stream every Slack-hosted file on a message (top-level or reply) → storage. */
  private async prefetchFiles(token: string, m: unknown, gcsPrefix: string): Promise<void> {
    for (const f of collectRawFiles(m)) {
      if (!isDownloadableSlackFile(f)) continue;
      const uri = await this.streamFileToGcs(token, f, gcsPrefix);
      if (uri) f.prefetchedStoragePath = uri;
    }
  }

  /** Fetch all replies of a thread (excluding the parent) and prefetch their files. */
  private async fetchReplies(token: string, channelId: string, ts: string, gcsPrefix: string): Promise<unknown[]> {
    const client = slackClient(token);
    const replies: unknown[] = [];
    let cursor: string | undefined;
    do {
      const r = await client.conversations.replies({ channel: channelId, ts, limit: PAGE, cursor });
      for (const m of r.messages ?? []) {
        if ((m as { ts?: string }).ts === ts) continue; // conversations.replies includes the parent first
        await this.prefetchFiles(token, m, gcsPrefix);
        replies.push(m);
      }
      cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
      if (cursor && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS);
    } while (cursor);
    return replies;
  }

  /** Stream one Slack-hosted file straight to storage (never buffered); returns its storage path. */
  private async streamFileToGcs(token: string, file: { id: string; url_private: string; url_private_download?: string; mimetype?: string }, gcsPrefix: string): Promise<string | undefined> {
    const dest = paths.file(gcsPrefix, file.id);
    const url = file.url_private_download || file.url_private;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
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
      await this.storage.uploadStreamToPath(encryptStream(res.body as NodeJS.ReadableStream), {
        path: dest,
        contentType: 'application/octet-stream',
      });
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

  async loadConversation(job: MigrationJob, conv: CollectedConversation, ref: SlackOfflineReference): Promise<number> {
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
        if (!job.channelInput?.xyneChannelId) return 0;
      } else {
        dmOwnerId = job.ownerSlackId ? await resolve(job.ownerSlackId) : undefined;
        if (!dmOwnerId) return 0;
        if (!isSelfDm) {
          for (const m of conv.members) if (m !== job.ownerSlackId) { const id = await resolve(m); if (id) dmOtherIds.push(id); }
          if (dmOtherIds.length === 0) return 0;
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
          out.push(await transformMessage(raw as never, (raw as { _replies?: never[] })._replies, cache, true, true, true, pinnedTs, job.workspaceId, ''));
        }
        return out;
      });
      if (messages.length === 0) return 0;

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

      await ingestConversationSlack({
        slackMessages: messages,
        externalSourceName: `${isChannel ? 'channelMigration' : 'dmMigration'}-${channelId}`,
        channelId,
        workspaceId: job.workspaceId,
        botToken: 'slack-migration-offline',
        interMessageDelayMs: INGEST_MESSAGE_DELAY_MS,
      });
      await channelRepo.recalculateLastActivityFromMessages(channelId);
      return messages.length;
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

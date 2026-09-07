/**
 * Migration-only BULK ingest path (opt-in via MIGRATION_INGEST_BULK).
 *
 * Reproduces what conversationService.createConversationWithMessage / addMessageToConversation do per message,
 * but as chunked Prisma createMany — one round-trip per BATCH instead of several per message. Bypasses the shared
 * conversationService entirely (so it never touches live messaging code), and is safe because:
 *  - every PK is a client-generated cuid, so ids are pre-generated and FKs wired in memory (no "temp then update");
 *  - the DB has NO field-level encryption (the extension is a no-op), so createMany stores exactly what create would;
 *  - migration already suppresses automations/meet-links/websocket, so there are no side effects to replicate.
 *
 * OOM-safe: rows accumulate up to MIGRATION_INGEST_BULK_BATCH_SIZE, then flush + release — never a whole channel at once.
 *
 * Parity with the per-message path (conversationService): mentions are resolved at collection; mentioned users are added
 * as MENTIONED participants (addMentionedParticipants); thread aggregates (replyCount / lastActivityAt / replies_md) and
 * participant read-state are re-synced on RESUME (see flush), so a retried/interrupted run doesn't leave a thread
 * under-counted, sorted stale, or unread.
 *
 * Now at functional parity with the per-message path: mentioned users → MENTIONED participants; resume re-syncs thread
 * aggregates + participant read-state; attachments are full-text indexed (fileSchema); custom emoji are replaced; and
 * replyBroadcast replies create their standalone child conversation. The channel_migrated analytics event is emitted.
 *
 * A broadcast reply's child conversation gets replyCount 1 unless it is the thread's final message — matching the
 * per-message path. Full parity; no known inconsistencies remain vs the serial/per-message path (bar suppressAutomations).
 */
import { logger } from '../../utils/logger';
import { ExternalEntityType, MessageDirection, MessageType } from '@xyne/shared';
import { serializeInitialMessageMd, serializeRepliesMd, serializeParentMessageMd, type InitialMessageSummary } from '@xyne/shared';
import { createId } from '@paralleldrive/cuid2';
import { replaceCustomEmojiShortcodesWithImg } from '@/utils/customEmojiUtils';
import { isSupportedMimeType } from '@/services/fileProcessor';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { UserRepository } from '../../database/repositories/users';
import { MessageRepository } from '../../database/repositories/messageRepository';
import { ExternalMessageRepository } from '../../database/repositories/externalMessageRepository';
import { ExternalSourceRepository } from '../../database/repositories/externalSourceRepository';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { ExternalAttachmentService, ExternalAttachment, DownloadedAttachment } from '@/services/externalAttachmentService';
import { SlackFile, UserInfoCache } from '../slack/utils/extractConversation';
import { encrypt } from '../../services/encryptionService';
import { config } from '../../config/env';
import { getMigrationRuntimeConfig } from '../self-serve/migrationRuntimeConfig';
import { db } from '@/database/client';
import { Prisma } from '@prisma/client';
import { vespaQueue, vespaBackfillQueue } from '@/queues/vespaQueue';
import { parseSlackTimestamp, findOrCreateUser, findOrCreateApp, type IngestConversationSlackInput, type IngestConversationSlackResult } from './ingestConversationSlack';

const VESPA_BACKFILL_AGE_DAYS = Number(process.env.VESPA_BACKFILL_AGE_DAYS ?? 365);

/** Historical (migrated) timestamps go to the backfill queue, matching conversationService.pickVespaQueue. */
function enqueueMessageVespa(messageId: string, workspaceId: string | undefined, createdAt: Date): void {
  const historical = Date.now() - createdAt.getTime() > VESPA_BACKFILL_AGE_DAYS * 86_400_000;
  const q = historical ? vespaBackfillQueue : vespaQueue;
  void q.addJob({ schema: 'chat_message', jobType: 'feed', docId: messageId, ...(workspaceId ? { workspaceId } : {}) })
    .catch((e) => logger.warn('[BulkIngest] vespa enqueue failed (non-fatal)', { messageId, error: e instanceof Error ? e.message : String(e) }));
}

/** Attachment full-text feed job (fileSchema) — mirrors conversationService.pushVespaJobForAttachments: supported MIME
 *  types only, backfill-routed by age, so migrated files (PDF/DOCX/TXT…) become searchable like the per-message path. */
function enqueueAttachmentVespa(attachmentId: string, mimeType: string, workspaceId: string | undefined, createdAt: Date): void {
  if (!isSupportedMimeType(mimeType)) return;
  const historical = Date.now() - createdAt.getTime() > VESPA_BACKFILL_AGE_DAYS * 86_400_000;
  const q = historical ? vespaBackfillQueue : vespaQueue;
  void q.addJob({ schema: fileSchema, jobType: 'feed', docId: attachmentId, app: SubApp.CHAT_ATTACHMENT, ...(workspaceId ? { workspaceId } : {}) })
    .catch((e) => logger.warn('[BulkIngest] attachment vespa enqueue failed (non-fatal)', { attachmentId, error: e instanceof Error ? e.message : String(e) }));
}

/** Custom-emoji `:shortcode:` → <img>, mirroring conversationService.replaceEmojisInContent. Self-short-circuits when
 *  content has no shortcodes (no DB hit in the common case); a no-op when the workspace has no matching custom emoji. */
async function applyCustomEmojis(content: string): Promise<string> {
  if (!content || content.includes('data-flow-json')) return content;
  return replaceCustomEmojiShortcodesWithImg(content);
}

/** Mentioned Xyne user ids embedded in resolved content — mirrors conversationService.extractMentionedUserIdsFromContent
 *  so the bulk path builds the same MENTIONED participant ("CC") rows the per-message path does. */
const MENTION_SPAN_RE = /<span\b[^>]*\bdata-user-id=["']([^"']+)["'][^>]*>/g;
function extractMentionedUserIds(content?: string | null): string[] {
  if (!content) return [];
  const ids: string[] = [];
  for (const m of content.matchAll(MENTION_SPAN_RE)) if (m[1]) ids.push(m[1]);
  return [...new Set(ids)];
}

export async function bulkIngestConversationSlack(input: IngestConversationSlackInput): Promise<IngestConversationSlackResult> {
  const { slackMessages, externalSourceName, channelId, workspaceId, userToken, botToken: inputBotToken, skipChannelMigratedUpdate = false, onProgress } = input;
  const BATCH = (await getMigrationRuntimeConfig()).bulkBatchSize; // live-tunable via Superposition; already clamped ≥50
  const errorDetails: string[] = [];

  const userRepo = new UserRepository();
  const externalSourceRepo = new ExternalSourceRepository();
  const externalMessageRepo = new ExternalMessageRepository();
  const channelRepo = new ChannelRepository();

  logger.info('[BulkIngest] starting', { externalSourceName, channelId, messageCount: slackMessages.length, batch: BATCH });

  // External source (same as the per-message path).
  let externalSource = await externalSourceRepo.findByName(externalSourceName);
  if (!externalSource) {
    const botToken = inputBotToken || config.slackBotToken;
    if (!botToken) throw new Error('SLACK_BOT_TOKEN is not configured');
    externalSource = await externalSourceRepo.create({
      name: externalSourceName, sourceType: 'slack', displayName: 'Slack Migration', channelId,
      credentials: encrypt(JSON.stringify({ botToken })),
    });
  }
  const externalSourceId = externalSource.id;

  // One batched dedup read instead of one findByExternalId per message/reply.
  const allExternalIds: string[] = [];
  for (const m of slackMessages) {
    allExternalIds.push(m.externalId);
    for (const r of m.replies ?? []) allExternalIds.push(r.externalThreadId);
  }
  const existingRows = allExternalIds.length ? await externalMessageRepo.findByExternalIds(externalSourceId, allExternalIds) : [];
  const existing = new Set((existingRows as Array<{ externalId: string }>).map((r) => r.externalId));

  const userCache = new Map<string, { id: string; isDeactivated: boolean }>();
  const botCache: UserInfoCache = new Map();
  // User ids proven to exist (message senders + verified mentions). Guarding participant inserts against this set
  // stops one stale mention id from FK-failing (and thus dropping) an entire flush batch. Mentions were resolved to
  // real users at collection; we still verify any not-yet-seen id once via a single batched read.
  const knownUserIds = new Set<string>();

  const downloadFiles = async (files: SlackFile[] | undefined): Promise<DownloadedAttachment[]> => {
    if (!files || files.length === 0) return [];
    try {
      const externalAttachments: ExternalAttachment[] = files
        .filter((f) => f.prefetchedStoragePath || f.url_private)
        .map((f) => f.prefetchedStoragePath
          ? { fileName: f.name, mimeType: f.mimetype, size: f.size, storageSourcePath: f.prefetchedStoragePath, storageSourceEncrypted: true }
          : { fileName: f.name, fileUrl: f.url_private, mimeType: f.mimetype, size: f.size });
      return await new ExternalAttachmentService().downloadAttachmentsForSource(externalSourceName, externalAttachments, {
        maxFileSize: 1024 * 1024 * 1024, timeout: 600000, scopeType: 'EXTERNAL_MESSAGE', scopeId: externalSourceName, overrideToken: userToken,
      });
    } catch (e) {
      logger.error('[BulkIngest] attachment download failed', { error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  };

  const resolveSender = async (msg: { userId?: string; userEmail?: string; userName?: string; isDeactivated?: boolean; botId?: string; botName?: string; botUserId?: string }): Promise<string | null> => {
    if (msg.userId) return msg.userId;
    if (msg.botId) return (await findOrCreateApp(msg.botName ?? msg.botId, msg.botId, botCache, msg.botUserId, workspaceId)) ?? null;
    if (!msg.userEmail || !msg.userName) return null;
    return findOrCreateUser(msg.userEmail, msg.userName, msg.isDeactivated ?? false, userRepo, userCache, workspaceId);
  };

  // Bounded accumulators — flushed at BATCH so memory never grows with conversation size.
  // Typed with the Prisma CreateMany inputs so the compiler validates every field name against the schema.
  let convRows: Prisma.ConversationCreateManyInput[] = [], msgRows: Prisma.MessageCreateManyInput[] = [];
  let attRows: Prisma.MessageAttachmentCreateManyInput[] = [], extRows: Prisma.ExternalMessageCreateManyInput[] = [];
  let partMap = new Map<string, Prisma.ConversationParticipantCreateManyInput>();
  const pendingVespa: Array<{ id: string; createdAt: Date }> = [];
  const pendingVespaFiles: Array<{ id: string; mimeType: string; createdAt: Date }> = [];
  // Re-sync work for RESUMED threads (parent already migrated on an earlier run) — applied after the createMany calls.
  const resumeUpdates: Array<{ conversationId: string; replyCount: number; lastActivityAt: Date; repliesMd: string | null; replierAuthorIds: string[] }> = [];
  let pending = 0;

  const flush = async (): Promise<void> => {
    if (pending === 0 && resumeUpdates.length === 0) return;
    if (convRows.length) await db.conversation.createMany({ data: convRows });
    if (msgRows.length) await db.message.createMany({ data: msgRows });
    if (attRows.length) await db.messageAttachment.createMany({ data: attRows });
    if (extRows.length) await db.externalMessage.createMany({ data: extRows, skipDuplicates: true });
    if (partMap.size) await db.conversationParticipant.createMany({ data: [...partMap.values()], skipDuplicates: true });
    // Resume re-sync: bring an already-migrated parent thread + its FIRST-RUN participants up to the full thread state,
    // so back-filled replies don't leave it under-counted, sorted stale, or unread. Values are authoritative from the dump.
    for (const u of resumeUpdates) {
      await db.conversation.update({
        where: { conversationId: u.conversationId },
        data: { replyCount: u.replyCount, lastActivityAt: u.lastActivityAt, replies_md: u.repliesMd },
      }).catch((e) => logger.warn('[BulkIngest] resume conversation re-sync failed', { conversationId: u.conversationId, error: e instanceof Error ? e.message : String(e) }));
      await db.conversationParticipant.updateMany({
        where: { conversationId: u.conversationId, lastReplyAt: { lt: u.lastActivityAt } },
        data: { lastReplyAt: u.lastActivityAt, lastReadAt: u.lastActivityAt },
      }).catch(() => undefined);
      if (u.replierAuthorIds.length) await db.conversationParticipant.updateMany({
        where: { conversationId: u.conversationId, userId: { in: u.replierAuthorIds }, participationType: 'MENTIONED' },
        data: { participationType: 'AUTHOR' },
      }).catch(() => undefined);
    }
    for (const v of pendingVespa) enqueueMessageVespa(v.id, workspaceId, v.createdAt);
    for (const f of pendingVespaFiles) enqueueAttachmentVespa(f.id, f.mimeType, workspaceId, f.createdAt);
    convRows = []; msgRows = []; attRows = []; extRows = []; partMap = new Map();
    pendingVespa.length = 0; pendingVespaFiles.length = 0; resumeUpdates.length = 0; pending = 0;
  };

  const addAttachments = (msgId: string, senderId: string, createdAt: Date, downloaded: DownloadedAttachment[], convId: string): void => {
    for (const a of downloaded) {
      const attId = createId();
      attRows.push({
        id: attId, entityId: msgId, entityType: 'CHAT', workspaceId, storageProvider: config.fileStorage.provider,
        originalFilename: a.originalName, mimetype: a.mimeType, size: a.fileSize, url: a.fileUrl,
        uploadedByUserId: senderId, createdBy: senderId, conversationId: convId,
        thumbnailUrl: null, width: null, height: null, // migration attachments don't carry thumbnails/dimensions
        metadata: a.metadata ?? {}, createdAt,
      });
      pendingVespaFiles.push({ id: attId, mimeType: a.mimeType, createdAt }); // full-text index the file, like the per-message path
      pending++;
    }
  };

  const addParticipant = (convId: string, userId: string, type: 'AUTHOR' | 'MENTIONED', readAt: Date): void => {
    const key = `${convId}:${userId}`;
    const existingP = partMap.get(key);
    if (existingP) {
      if (type === 'AUTHOR') existingP.participationType = 'AUTHOR';
      if ((existingP.lastReplyAt as Date) < readAt) { existingP.lastReplyAt = readAt; existingP.lastReadAt = readAt; }
      return;
    }
    partMap.set(key, {
      id: createId(), conversationId: convId, workspaceId, userId, participationType: type, channelId,
      lastReadAt: readAt, lastReplyAt: readAt,
    });
    pending++;
  };

  // Extract @mentions from the (already resolved) content and add each as a MENTIONED participant — the "CC" the UI
  // shows. Unknown ids are verified once in a single batched read so a bad id never FK-fails the whole flush.
  const addMentionedParticipants = async (convId: string, content: string, readAt: Date): Promise<void> => {
    const ids = extractMentionedUserIds(content);
    if (ids.length === 0) return;
    const unknown = ids.filter((id) => !knownUserIds.has(id));
    if (unknown.length) {
      const rows = await db.user.findMany({ where: { id: { in: unknown } }, select: { id: true } });
      for (const r of rows) knownUserIds.add(r.id);
    }
    for (const id of ids) if (knownUserIds.has(id)) addParticipant(convId, id, 'MENTIONED', readAt);
  };

  let processed = 0;
  for (const m of slackMessages) {
    try {
      const parentDone = existing.has(m.externalId);
      const newReplies = (m.replies ?? []).filter((r) => !existing.has(r.externalThreadId));
      if (parentDone && newReplies.length === 0) continue; // whole thread already migrated → skip

      const senderId = await resolveSender(m);
      if (!senderId) throw new Error(`Missing sender for message ${m.externalId}`);
      knownUserIds.add(senderId);
      const createdAt = parseSlackTimestamp(m.externalId);

      // Thread aggregates from the FULL inline reply set — authoritative for BOTH a fresh thread and a resumed one
      // (the dump always carries every reply), so a resume can re-sync them rather than leaving stale first-run values.
      const replyTimes = (m.replies ?? []).map((r) => parseSlackTimestamp(r.externalThreadId).getTime());
      const lastActivityAt = new Date(Math.max(createdAt.getTime(), ...replyTimes));
      let repliers: string[] = [];
      for (const r of m.replies ?? []) { const s = r.userId; if (s) { repliers = repliers.filter((id) => id !== s); repliers.push(s); } }
      const replyCount = (m.replies ?? []).length;
      const repliesMd = repliers.length ? serializeRepliesMd({ repliers }) : null;
      // The final message in the thread. A broadcast reply's child gets replyCount 1 unless it IS the final message —
      // equivalent to the per-message path's "bump the previous broadcast child when a later message arrives", but
      // derived from the complete dump so it's correct on a fresh run AND a resume (no stateful prev-message tracking).
      const lastReplyExternalId = m.replies?.length ? m.replies[m.replies.length - 1].externalThreadId : undefined;

      // Resolve the thread's conversationId: reuse if the parent was already migrated (resume), else create a new thread.
      // parentRef carries the thread-root message so a replyBroadcast reply can point its child conversation back at it.
      let convId: string;
      let parentRef: { messageId: string; senderId: string; content: string; createdAt: Date };
      if (parentDone) {
        const threadRow = await externalMessageRepo.findByThreadId(externalSourceId, m.externalId, ExternalEntityType.MESSAGE);
        const parentMsg = threadRow?.entityId ? await new MessageRepository().findById(threadRow.entityId) : null;
        if (!parentMsg?.conversationId) throw new Error(`Cannot locate conversation for migrated parent ${m.externalId}`);
        convId = parentMsg.conversationId;
        parentRef = { messageId: parentMsg.messageId, senderId: parentMsg.senderId, content: parentMsg.content, createdAt: parentMsg.createdAt };
        // Back-filling replies the first run missed → re-sync the parent's aggregates + participant read-state, which
        // the per-message path does via incrementReplyCount but a plain createMany would otherwise leave frozen (see flush).
        resumeUpdates.push({ conversationId: convId, replyCount, lastActivityAt, repliesMd, replierAuthorIds: repliers.slice() });
      } else {
        convId = createId();
        const parentMsgId = createId();
        const parentFiles = await downloadFiles(m.files);
        let content = m.content ?? '';
        if ((!content || !content.trim()) && parentFiles.length === 0 && (m.files?.length ?? 0) > 0) {
          content = (m.files as SlackFile[]).map((f) => `📎 ${f.name}`).join(' ');
        }
        content = await applyCustomEmojis(content);
        parentRef = { messageId: parentMsgId, senderId, content, createdAt };
        const summary: InitialMessageSummary = {
          messageId: parentMsgId, conversationId: convId, senderId, content, msgType: MessageType.USER as InitialMessageSummary['msgType'],
          hasAttachment: parentFiles.length > 0, edited: false, isDeleted: false, showInChannel: false, visibleTo: null,
          createdAt: createdAt.getTime(), metadata: JSON.stringify({ contentFormat: 'html' }), nudgeCount: 0, isSent: true,
          reactions_md: null, link_preview_md: null, childConversationId: null,
        };
        convRows.push({
          conversationId: convId, channelId, workspaceId, createdBy: senderId, initialMessageId: parentMsgId,
          pinned: !!m.isPinned, createdAt, lastActivityAt, replyCount,
          initial_message_md: serializeInitialMessageMd(summary), replies_md: repliesMd,
        }); pending++;
        msgRows.push({
          messageId: parentMsgId, conversationId: convId, senderId, workspaceId, content, msgType: 'USER',
          hasAttachment: parentFiles.length > 0, metadata: { contentFormat: 'html' }, createdAt,
        }); pending++;
        extRows.push({
          workspaceId, externalSourceId, externalId: m.externalId, externalThreadId: m.externalId,
          entityId: parentMsgId, messageId: parentMsgId, direction: MessageDirection.INCOMING, entityType: 'MESSAGE',
        }); pending++;
        addAttachments(parentMsgId, senderId, createdAt, parentFiles, convId);
        addParticipant(convId, senderId, 'AUTHOR', lastActivityAt);
        await addMentionedParticipants(convId, content, lastActivityAt);
        pendingVespa.push({ id: parentMsgId, createdAt });
      }

      // Replies (new only) → attach to the thread conversation. Participant timestamps use the thread's lastActivityAt
      // (matching the per-message path, where every participant's lastReplyAt = conversation.lastActivityAt).
      for (const r of newReplies) {
        try {
          const replySender = await resolveSender(r);
          if (!replySender) throw new Error(`Missing sender for reply ${r.externalThreadId}`);
          knownUserIds.add(replySender);
          const replyCreatedAt = parseSlackTimestamp(r.externalThreadId);
          const replyMsgId = createId();
          const replyFiles = await downloadFiles(r.files);
          let content = r.content ?? '';
          if ((!content || !content.trim()) && replyFiles.length === 0 && (r.files?.length ?? 0) > 0) {
            content = (r.files as SlackFile[]).map((f) => `📎 ${f.name}`).join(' ');
          }
          content = await applyCustomEmojis(content);
          // replyBroadcast ("also sent to channel"): the reply is ALSO the initial message of a standalone CHILD
          // conversation in the channel, back-linked to the thread root — mirroring conversationService's child branch.
          const childConvId = r.showInChannel ? createId() : undefined;
          msgRows.push({
            messageId: replyMsgId, conversationId: convId, senderId: replySender, workspaceId, content, msgType: 'USER',
            hasAttachment: replyFiles.length > 0, showInChannel: !!r.showInChannel,
            ...(childConvId ? { childConversationId: childConvId } : {}),
            metadata: { contentFormat: 'html' }, createdAt: replyCreatedAt,
          }); pending++;
          extRows.push({
            workspaceId, externalSourceId, externalId: r.externalThreadId, externalThreadId: m.externalId,
            entityId: replyMsgId, messageId: replyMsgId, direction: MessageDirection.INCOMING, entityType: 'MESSAGE',
          }); pending++;
          if (childConvId) {
            const childSummary: InitialMessageSummary = {
              messageId: replyMsgId, conversationId: childConvId, senderId: replySender, content, msgType: MessageType.USER as InitialMessageSummary['msgType'],
              hasAttachment: replyFiles.length > 0, edited: false, isDeleted: false, showInChannel: true, visibleTo: null,
              createdAt: replyCreatedAt.getTime(), metadata: JSON.stringify({ contentFormat: 'html' }), nudgeCount: 0, isSent: true,
              reactions_md: null, link_preview_md: null, childConversationId: childConvId,
            };
            convRows.push({
              conversationId: childConvId, channelId, workspaceId, createdBy: replySender, initialMessageId: replyMsgId,
              parentMessageId: parentRef.messageId, pinned: false, createdAt: replyCreatedAt, lastActivityAt: replyCreatedAt,
              replyCount: r.externalThreadId === lastReplyExternalId ? 0 : 1,
              initial_message_md: serializeInitialMessageMd(childSummary),
              parent_message_md: serializeParentMessageMd({
                messageId: parentRef.messageId, conversationId: convId, senderId: parentRef.senderId,
                content: parentRef.content, msgType: MessageType.USER, createdAt: parentRef.createdAt.getTime(),
              }),
            }); pending++;
          }
          addAttachments(replyMsgId, replySender, replyCreatedAt, replyFiles, convId);
          addParticipant(convId, replySender, 'AUTHOR', lastActivityAt);
          await addMentionedParticipants(convId, content, lastActivityAt);
          pendingVespa.push({ id: replyMsgId, createdAt: replyCreatedAt });
        } catch (err) {
          errorDetails.push(`reply ${r.externalThreadId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (pending >= BATCH) await flush();
      }

      if (pending >= BATCH) await flush();
      if (++processed % 200 === 0) onProgress?.();
    } catch (err) {
      errorDetails.push(`message ${m.externalId}: ${err instanceof Error ? err.message : String(err)}`);
      logger.error('[BulkIngest] thread failed', { externalId: m.externalId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await flush();

  // Once per conversation (channel/DM): set last-activity from the migrated messages and flip isMigrated.
  await channelRepo.recalculateLastActivityFromMessages(channelId).catch(() => undefined);
  if (!skipChannelMigratedUpdate) {
    const channel = await channelRepo.findById(channelId);
    if (channel && !(channel as { isMigrated?: boolean }).isMigrated) {
      await channelRepo.update(channelId, { isMigrated: true }).catch(() => undefined);
      // Match the per-message path's completion analytics (ingestConversationSlack) so bulk-migrated channels aren't undercounted.
      const projectId = (channel as { projectId?: string | null }).projectId;
      const project = projectId
        ? await db.project.findUnique({ where: { id: projectId }, select: { name: true } }).catch(() => null)
        : null;
      logger.info('analytics_event', {
        event: 'channel_migrated', timestamp: new Date().toISOString(), channelId,
        channelName: (channel as { name?: string }).name, channelProjectName: project?.name ?? null, sourceType: 'slack',
      });
    }
  }

  logger.info('[BulkIngest] complete', { externalSourceName, channelId, errors: errorDetails.length });
  return { success: errorDetails.length === 0, errorDetails: errorDetails.length ? errorDetails : undefined };
}

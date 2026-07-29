import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import { extractAllSlackIds, resolveApiGroup } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { WebClient } from '@slack/web-api';
import { getBotConfigByWorkspaceId } from '@/migration/slack/slackMigrationBotConfig';

const TAG = '[UnknownGroupBackfill]';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

function buildGroupMentionSpan(group: { id: string; name: string; alias?: string | null; description?: string | null }): string {
  const display = group.alias || group.name;
  const attrs = [
    'data-mention',
    'data-mention-type="group"',
    `data-group-id="${escapeHtml(group.id)}"`,
    `data-group-name="${escapeHtml(group.name)}"`,
  ];
  if (group.description) attrs.push(`data-description="${escapeHtml(group.description)}"`);
  if (group.alias) attrs.push(`data-group-alias="${escapeHtml(group.alias)}"`);
  return `<span ${attrs.join(' ')}>@${escapeHtml(display)}</span>`;
}

/**
 * Replace <span>@unknown group</span> instances in storedHtml with proper group spans.
 *
 * Groups whose Xyne ID already appears as data-group-id in the stored HTML were resolved
 * correctly. The remaining ones (in order of first appearance in originalSlackText) map
 * one-to-one to the @unknown group spans and are replaced in that order.
 */
async function resolveUnknownGroupsInContent(
  storedHtml: string,
  originalSlackText: string,
  botToken: string,
  workspaceId: string,
): Promise<string> {
  const uniqueGroupIds = extractAllSlackIds(originalSlackText, false);
  if (uniqueGroupIds.length === 0) return storedHtml;

  // Resolve every group — DB lookup by slackGroupId metadata first, then Slack API / create
  const groupById = new Map<string, { id: string; name: string; alias: string | null; description: string | null } | null>();
  for (const slackGroupId of uniqueGroupIds) {
    const existing = await db.userGroup.findFirst({
      where: {
        workspaceId,
        metadata: { path: ['slackGroupId'], equals: slackGroupId },
      },
      select: { id: true, name: true, alias: true, description: true },
    });
    if (existing) {
      groupById.set(slackGroupId, existing);
      continue;
    }
    const xyneGroupId = await resolveApiGroup(slackGroupId, botToken, workspaceId);
    if (xyneGroupId) {
      const created = await db.userGroup.findUnique({
        where: { id: xyneGroupId },
        select: { id: true, name: true, alias: true, description: true },
      });
      groupById.set(slackGroupId, created ?? null);
    } else {
      groupById.set(slackGroupId, null);
    }
  }

  // Which Xyne group IDs are already correctly resolved in the stored HTML
  const resolvedXyneIds = new Set(
    [...storedHtml.matchAll(/data-group-id="([^"]+)"/g)].map(m => m[1]),
  );

  // Count per-group occurrences in original text to handle duplicate mentions
  const allGroupIds = (
    originalSlackText.match(/<!subteam\^([^>|]+)(?:\|[^>]*)?>/g) ?? []
  ).map(s => s.match(/<!subteam\^([^>|]+)/)?.[1]).filter(Boolean) as string[];

  const countBySlackId = new Map<string, number>();
  for (const gid of allGroupIds) {
    countBySlackId.set(gid, (countBySlackId.get(gid) ?? 0) + 1);
  }

  // Replace @unknown group spans in the order group IDs appear in the original text
  let content = storedHtml;
  for (const slackGroupId of uniqueGroupIds) {
    const group = groupById.get(slackGroupId);
    if (!group) continue;
    if (resolvedXyneIds.has(group.id)) continue;

    const count = countBySlackId.get(slackGroupId) ?? 1;
    const replacement = buildGroupMentionSpan(group);
    let replaced = 0;
    content = content.replace(/<span>@unknown group<\/span>/g, (match) => {
      if (replaced < count) { replaced++; return replacement; }
      return match;
    });
    resolvedXyneIds.add(group.id);
  }

  return content;
}

/**
 * Fetch all messages in a Slack thread, following pagination cursors.
 * Stores results into slackTextByTs (ts → text).
 */
async function fetchThreadIntoCache(
  slackClient: WebClient,
  slackChannelId: string,
  threadTs: string,
  slackTextByTs: Map<string, string>,
): Promise<void> {
  let cursor: string | undefined;
  do {
    const result = await slackClient.conversations.replies({
      channel: slackChannelId,
      ts: threadTs,
      limit: 1000,
      ...(cursor && { cursor }),
    });
    for (const msg of result.messages ?? []) {
      if (msg.ts && msg.text) slackTextByTs.set(msg.ts, msg.text);
    }
    cursor = result.has_more ? result.response_metadata?.next_cursor : undefined;
  } while (cursor);
}

export class UnknownGroupBackfillController {
  /**
   * POST /api/migration/cleanup/unknown-group-backfill
   * Body: {
   *   // Option A — single channel
   *   slackChannelId?: string,
   *   xynespacesChannelId?: string,
   *
   *   // Option B — multiple channels (processed sequentially)
   *   channels?: Record<string, string>,  // { "<slackChannelId>": "<xynespacesChannelId>", ... }
   *
   *   dryRun?: boolean,    // default true — log only, no DB writes
   *   batchSize?: number,  // conversations per batch (default 20)
   *   delayMs?: number     // ms between batches (default 2000)
   * }
   *
   * Memory model: only conversation IDs are held across the full run.
   * All message contents, ExternalMessage records, and Slack thread texts are fetched
   * and discarded within each batch — memory stays O(batchSize) throughout.
   */
  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const {
        slackChannelId,
        xynespacesChannelId,
        channels,
        dryRun = true,
        batchSize = 20,
        delayMs = 2_000,
      } = req.body as {
        slackChannelId?: string;
        xynespacesChannelId?: string;
        channels?: Record<string, string>;
        dryRun?: boolean;
        batchSize?: number;
        delayMs?: number;
      };

      // Build a normalised map of slackChannelId → xynespacesChannelId
      const channelMap: Record<string, string> = {};

      if (channels && typeof channels === 'object' && !Array.isArray(channels)) {
        Object.assign(channelMap, channels);
      }
      if (slackChannelId && xynespacesChannelId) {
        channelMap[slackChannelId] = xynespacesChannelId;
      }

      const entries = Object.entries(channelMap);
      if (entries.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Provide either channels map or slackChannelId + xynespacesChannelId',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      res.json({
        success: true,
        message: `Backfill ${dryRun ? '(dry run) ' : ''}started for ${entries.length} channel(s). batchSize=${batchSize} delayMs=${delayMs}. Check logs for progress.`,
        data: { channels: channelMap, dryRun, batchSize, delayMs },
        timestamp: new Date().toISOString(),
      });

      (async () => {
        for (let i = 0; i < entries.length; i++) {
          const [slackId, xyneId] = entries[i];
          logger.info(`${TAG} ===== Channel ${i + 1}/${entries.length}: slack=${slackId} xyne=${xyneId} =====`);
          await UnknownGroupBackfillController.runBackfill(slackId, xyneId, dryRun, batchSize, delayMs);
        }
        logger.info(`${TAG} ===== ALL ${entries.length} CHANNEL(S) COMPLETE =====`);
      })().catch(err => logger.error(`${TAG} Background job crashed:`, err));
    } catch (error) {
      logger.error(`${TAG} Failed to start backfill:`, error);
      res.status(500).json({ success: false, error: 'Failed to start unknown group backfill', timestamp: new Date().toISOString() });
    }
  }

  private static async runBackfill(
    slackChannelId: string,
    xynespacesChannelId: string,
    dryRun: boolean,
    batchSize: number,
    delayMs: number,
  ): Promise<void> {
    logger.info(`${TAG} Starting backfill`, { slackChannelId, xynespacesChannelId, dryRun, batchSize, delayMs });

    // ── 1. Resolve workspace + bot config ────────────────────────────────────
    const channel = await db.channel.findUnique({
      where: { id: xynespacesChannelId },
      select: { workspaceId: true },
    });
    if (!channel) {
      logger.error(`${TAG} Channel not found: ${xynespacesChannelId}`);
      return;
    }

    const botConfig = getBotConfigByWorkspaceId(channel.workspaceId);
    if (!botConfig?.slackBotToken) {
      logger.error(`${TAG} No bot token for workspace ${channel.workspaceId}`);
      return;
    }

    const slackClient = new WebClient(botConfig.slackBotToken);

    // ── 2. Fetch only conversation IDs — the ONLY data held across the full run ─
    const allConvIds: string[] = (
      await db.conversation.findMany({
        where: {
          channelId: xynespacesChannelId,
          OR: [
            { initial_message_md: { contains: '<span>@unknown group</span>' } },
            { messages: { some: { content: { contains: '@unknown group' } } } },
          ],
        },
        select: { conversationId: true },
      })
    ).map(c => c.conversationId);

    logger.info(`${TAG} Found ${allConvIds.length} conversations with @unknown group`);
    if (allConvIds.length === 0) return;

    const totalBatches = Math.ceil(allConvIds.length / batchSize);
    let totalProcessed = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;

    // ── 3. Process strictly in batches — all data is batch-scoped → GC'd after each batch ──
    for (let batchStart = 0; batchStart < allConvIds.length; batchStart += batchSize) {
      const batchIds = allConvIds.slice(batchStart, batchStart + batchSize);
      const batchNum = Math.floor(batchStart / batchSize) + 1;

      logger.info(`${TAG} Batch ${batchNum}/${totalBatches} — loading data for ${batchIds.length} conversations`);

      // Fetch full conversation rows for this batch only
      const conversations = await db.conversation.findMany({
        where: { conversationId: { in: batchIds } },
        select: { conversationId: true, initialMessageId: true, initial_message_md: true },
      });

      // Fetch messages with @unknown for this batch only
      const messagesWithUnknown = await db.message.findMany({
        where: {
          conversationId: { in: batchIds },
          content: { contains: '@unknown group' },
        },
        select: { messageId: true, content: true, conversationId: true },
      });

      const msgMap = new Map(messagesWithUnknown.map(m => [m.messageId, { ...m }]));

      // Fetch initial messages whose content may not have @unknown (preview-only edge case)
      const initialIdsNotInMap = conversations
        .filter(c => c.initial_message_md?.includes('@unknown group') && c.initialMessageId && !msgMap.has(c.initialMessageId!))
        .map(c => c.initialMessageId!);

      if (initialIdsNotInMap.length > 0) {
        const extra = await db.message.findMany({
          where: { messageId: { in: initialIdsNotInMap } },
          select: { messageId: true, content: true, conversationId: true },
        });
        for (const m of extra) msgMap.set(m.messageId, { ...m });
      }

      // Fetch ExternalMessage records for this batch only
      const externalMsgs = await db.externalMessage.findMany({
        where: { messageId: { in: [...msgMap.keys()] } },
        select: { messageId: true, externalId: true, externalThreadId: true },
      });
      const extByMessageId = new Map(externalMsgs.map(e => [e.messageId, e]));

      // Collect unique thread timestamps needed for this batch.
      // Fall back to externalId when externalThreadId is null — reply messages whose
      // thread_ts was not stored still need their individual ts fetched from Slack.
      const uniqueThreadTs = new Set<string>();
      for (const ext of externalMsgs) {
        uniqueThreadTs.add(ext.externalThreadId ?? ext.externalId);
      }

      logger.info(`${TAG} Batch ${batchNum}/${totalBatches} — fetching ${uniqueThreadTs.size} Slack threads`);

      // Batch-scoped Slack text cache: ts → original text (freed when batch ends)
      const slackTextByTs = new Map<string, string>();

      for (const threadTs of uniqueThreadTs) {
        try {
          await fetchThreadIntoCache(slackClient, slackChannelId, threadTs, slackTextByTs);
        } catch (err) {
          logger.warn(`${TAG} Failed to fetch Slack thread ts=${threadTs}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        // Small gap between Slack API calls to stay within Tier-3 rate limits
        await sleep(200);
      }

      logger.info(`${TAG} Batch ${batchNum}/${totalBatches} — cached ${slackTextByTs.size} Slack messages, processing`);

      // ── Process conversations in this batch ─────────────────────────────────
      for (const conv of conversations) {
        try {
          totalProcessed++;

          const hasInitialUnknown = conv.initial_message_md?.includes('@unknown group') ?? false;

          const messageIdsToFix = new Set<string>(
            messagesWithUnknown
              .filter(m => m.conversationId === conv.conversationId)
              .map(m => m.messageId),
          );
          if (hasInitialUnknown && conv.initialMessageId) {
            messageIdsToFix.add(conv.initialMessageId);
          }

          if (messageIdsToFix.size === 0) { totalSkipped++; continue; }

          let conversationUpdated = false;

          for (const messageId of messageIdsToFix) {
            const msgData = msgMap.get(messageId);
            if (!msgData?.content?.includes('@unknown group')) continue;

            const ext = extByMessageId.get(messageId);
            if (!ext) {
              logger.warn(`${TAG} No ExternalMessage for messageId=${messageId}`);
              continue;
            }

            const originalText = slackTextByTs.get(ext.externalId) ?? '';
            if (!originalText) {
              logger.warn(`${TAG} No cached Slack text for messageId=${messageId} (ts=${ext.externalId})`);
              continue;
            }

            if (dryRun) {
              logger.info(`${TAG} DRY RUN: messageId=${messageId} groupIds=${extractAllSlackIds(originalText, false).join(', ')}`);
              conversationUpdated = true;
              continue;
            }

            const updatedContent = await resolveUnknownGroupsInContent(
              msgData.content,
              originalText,
              botConfig.slackBotToken,
              channel.workspaceId,
            );

            if (updatedContent === msgData.content) continue;

            await db.message.update({ where: { messageId }, data: { content: updatedContent } });
            msgData.content = updatedContent;
            logger.info(`${TAG} Updated message ${messageId}`);
            conversationUpdated = true;

            // Sync initial_message_md when this message is the initial message
            if (messageId === conv.initialMessageId && conv.initial_message_md?.includes('@unknown group')) {
              const updatedInitialMd = await resolveUnknownGroupsInContent(
                conv.initial_message_md,
                originalText,
                botConfig.slackBotToken,
                channel.workspaceId,
              );
              await db.conversation.update({
                where: { conversationId: conv.conversationId },
                data: { initial_message_md: updatedInitialMd },
              });
              conv.initial_message_md = updatedInitialMd;
              logger.info(`${TAG} Updated initial_message_md for conversation ${conv.conversationId}`);
            }
          }

          // Edge case: @unknown only in initial_message_md (message content already fixed)
          if (!dryRun && conv.initial_message_md?.includes('@unknown group') && conv.initialMessageId) {
            const ext = extByMessageId.get(conv.initialMessageId);
            if (ext) {
              const originalText = slackTextByTs.get(ext.externalId) ?? '';
              if (originalText) {
                const updatedInitialMd = await resolveUnknownGroupsInContent(
                  conv.initial_message_md,
                  originalText,
                  botConfig.slackBotToken,
                  channel.workspaceId,
                );
                if (updatedInitialMd !== conv.initial_message_md) {
                  await db.conversation.update({
                    where: { conversationId: conv.conversationId },
                    data: { initial_message_md: updatedInitialMd },
                  });
                  conv.initial_message_md = updatedInitialMd;
                  conversationUpdated = true;
                  logger.info(`${TAG} Updated initial_message_md (standalone) for conversation ${conv.conversationId}`);
                }
              }
            }
          }

          if (conversationUpdated) totalUpdated++;
          else totalSkipped++;
        } catch (error) {
          totalErrors++;
          logger.error(`${TAG} Error processing conversation ${conv.conversationId}:`, error);
        }
      }

      // conversations, messagesWithUnknown, msgMap, externalMsgs, slackTextByTs
      // all go out of scope here → GC'd before next batch
      logger.info(`${TAG} Batch ${batchNum}/${totalBatches} done — processed=${totalProcessed} updated=${totalUpdated} skipped=${totalSkipped} errors=${totalErrors}`);

      if (batchStart + batchSize < allConvIds.length) await sleep(delayMs);
    }

    logger.info(`${TAG} BACKFILL COMPLETE`, { totalProcessed, totalUpdated, totalSkipped, totalErrors, dryRun });
  }
}

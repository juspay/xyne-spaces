/**
 * Google Gmail fetch.
 */

import { ExternalSource } from '@prisma/client';
import { GoogleService } from '@/services/googleService';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { GoogleTransformer } from './transformer';
import { preDownloadGmailAttachments } from './attachments';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { emailService } from '@/services/emailService';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { AttachmentConversionService } from '@/services/externalAttachmentService';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { externalSourceCore } from '../../core/core';
import { advanceSyncCursor } from '@/services/syncCursorRecovery';
import { ExternalSourceAdapter } from '../../core/types';
import { MessageDirection } from '@xyne/shared';

const TAG = '[GoogleRefetch]';
const transformer = new GoogleTransformer();
const preferenceRepo = new EmailChannelPreferenceRepository();
const channelRepo = new ChannelRepository();
const emailRepo = new EmailRepository();
const externalMessageRepo = new ExternalMessageRepository();

export class GoogleRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    if (!options?.startDate || !options?.endDate) {
      throw new Error(
        '[GoogleRefetch] startDate and endDate are required — manual refetch is range-only',
      );
    }

    const ingestChannelId = options.targetChannelId ?? source.channelId;
    if (!ingestChannelId) {
      throw new Error(`[GoogleRefetch] source ${source.name} has no channel to ingest into`);
    }

    const google = GoogleService.fromEncryptedCredentials(source.credentials, source.id);
    const preference = await preferenceRepo.findByChannelId(ingestChannelId);
    const userId = preference?.ownerUserId ?? source.displayName;
    const extraQuery = options.dlEmail
      ? `(to:${options.dlEmail} OR cc:${options.dlEmail} OR from:${options.dlEmail})`
      : undefined;

    // Step 1: list messages in the window
    const messages = await google.listMessagesByDateRange({
      startDate: options.startDate,
      endDate: options.endDate,
      ...(extraQuery && { extraQuery }),
      ...(options.dlEmail && { maxMessages: null }),
    });
    logger.info(`${TAG} range listing returned ${messages.length} messages`, {
      startDate: options.startDate,
      endDate: options.endDate,
    });

    // Step 2: group by threadId.
    const grouped = new Map<string, string[]>();
    for (const m of messages) {
      const ids = grouped.get(m.threadId);
      if (ids) ids.push(m.id);
      else grouped.set(m.threadId, [m.id]);
    }
    let threadGroups = Array.from(grouped.entries()); // [threadId, messageIds[]]

    const allMessageIds = threadGroups.flatMap(([, ids]) => ids);
    if (allMessageIds.length > 0) {
      const existing = await emailRepo.findExistingExternalMessageIds(allMessageIds, ingestChannelId);
      if (existing.length > 0) {
        const existingSet = new Set(existing);
        const skippedIds = allMessageIds.filter(id => existingSet.has(id));
        if (skippedIds.length > 0) {
          await this.backfillSkippedRfcMessageIds(google, ingestChannelId, skippedIds);
        }
        let skippedBeforeFetch = 0;
        const filtered: typeof threadGroups = [];
        for (const [threadId, ids] of threadGroups) {
          const remaining = ids.filter(id => !existingSet.has(id));
          skippedBeforeFetch += ids.length - remaining.length;
          if (remaining.length > 0) filtered.push([threadId, remaining]);
        }
        threadGroups = filtered;
        logger.info(
          `${TAG} pre-dedup: skipped ${skippedBeforeFetch} already-ingested messages; ${threadGroups.length} threads remain`,
        );
      }
    }

    // Step 3: process threads in parallel up to batchSize, but each
    // thread's messages flow into a single ingestEmailThread call.
    let processed = 0;
    let newTickets = 0;
    let skipped = 0;
    // Threads where the normal-case unread bump would have fired inline
    // (i.e. ingestEmailThread inserted emails into a non-Vespa-merged
    // conversation). We accumulate the count and do ONE channel-wide
    // updateMany at the end of the run instead of N (one per thread).
    let threadsNeedingUnreadBump = 0;
    const errors: string[] = [];

    const ingestThread = async (
      threadId: string,
      messageIds: string[],
    ): Promise<void> => {
      try {
        let skippedDrafts = 0;
        const fetched = await Promise.all(
          messageIds.map(async id => {
            const messageData = await google.getMessageById(id);
            if (!messageData) return null;
            if ((messageData.labelIds ?? []).includes('DRAFT')) {
              skippedDrafts += 1;
              logger.info(`${TAG} skipping Gmail draft message ${id}`, {
                threadId,
                labelIds: messageData.labelIds,
              });
              return null;
            }
            logger.info(`${TAG} fetched new email for channel ${ingestChannelId}`, { messageId: id, threadId });

            const parsedEmail = google.parseEmailData(messageData);
            const preDownloadedAttachments = await preDownloadGmailAttachments({
              googleService: google,
              messageId: id,
              messageData,
              sourceName: source.name,
            });

            const parsed = await transformer.transform({
              parsedEmail: { ...parsedEmail, attachments: [] },
              ...(preDownloadedAttachments.length > 0 && { preDownloadedAttachments }),
            });
            if (!parsed.success || !parsed.data) throw new Error(parsed.error);
            return {
              data: parsed.data,
              uploadedFiles:
                AttachmentConversionService.convertDownloadedToUploaded(preDownloadedAttachments),
            };
          }),
        );
        skipped += skippedDrafts;

        const validParsed = fetched.filter(
          (d): d is NonNullable<typeof d> =>
            d !== null && !!d.data.emailData?.from && !!d.data.emailData?.to,
        );
        if (validParsed.length === 0) return;

        const allRefs = validParsed.flatMap(d => d.data.referencedMessageIds ?? []);
        const referencedMessageIds = allRefs.length > 0 ? [...new Set(allRefs)] : undefined;

        const result = await emailService.ingestEmailThread({
          channelId: ingestChannelId,
          externalThreadId: threadId,
          externalSourceId: source.id,
          userId,
          ticketMetadata: validParsed[0]!.data.metadata,
          referencedMessageIds,
          emails: validParsed.map(({ data: d, uploadedFiles }) => ({
            externalMessageId: d.externalId,
            rfcMessageId: d.rfcMessageId,
            subject: d.emailData!.subject ?? '',
            body: d.content,
            from: d.emailData!.from!,
            to: d.emailData!.to ?? [],
            cc: d.emailData!.cc ?? [],
            bcc: d.emailData!.bcc ?? [],
            replyTo: d.emailData!.replyTo ?? [],
            receivedAt: d.metadata.timestamp,
            uploadedFiles,
          })),
        });

        processed += result.inserted;
        skipped += result.duplicates;
        if (result.isNew) newTickets += 1;
        // Count this thread for the batched unread bump only if (a) it
        // actually inserted emails and (b) it WASN'T a Vespa merge —
        // Vespa-merge threads bump a subset of users inline; the batched
        // bump targets all members of the channel.
        if (result.inserted > 0 && !result.wasVespaMerge) {
          threadsNeedingUnreadBump += 1;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`${TAG} thread ${threadId} ingest failed`, { error: msg });
        errors.push(msg);
      }
    };

    const { batchSize, batchDelayMs } = config.emailFetch;
    for (let i = 0; i < threadGroups.length; i += batchSize) {
      const batch = threadGroups.slice(i, i + batchSize);
      await Promise.all(batch.map(([threadId, ids]) => ingestThread(threadId, ids)));

      if (batchDelayMs > 0 && i + batchSize < threadGroups.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }

    // End-of-run batched writes. Collapses N per-thread channel-level
    // mutations into 1, dramatically reducing CVR fanout to subscribed
    // clients. Both writes are conditional on actual insertions.
    if (threadsNeedingUnreadBump > 0) {
      try {
        await channelRepo.incrementUnreadForAllMembers(
          ingestChannelId,
          threadsNeedingUnreadBump,
        );
      } catch (error) {
        logger.warn(`${TAG} incrementUnreadForAllMembers (end-of-refetch) failed`, { error });
      }
    }
    if (processed > 0) {
      try {
        await channelRepo.updateLastActivity(ingestChannelId);
      } catch (error) {
        logger.warn(`${TAG} updateLastActivity (end-of-refetch) failed`, { error });
      }
    }

    logger.info(
      `${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length}`,
      { dlEmail: options.dlEmail, ingestChannelId },
    );
    return { processed, newTickets, skipped, errors };
  }

  private async backfillSkippedRfcMessageIds(
    google: GoogleService,
    channelId: string,
    messageIds: string[],
  ): Promise<void> {
    try {
      const rows = await Promise.all(
        messageIds.map(async id => {
          const messageData = await google.getMessageById(id);
          if (!messageData) return null;
          const parsedEmail = google.parseEmailData(messageData);
          return {
            externalMessageId: id,
            rfcMessageId: parsedEmail.rfcMessageId,
          };
        }),
      );
      const backfilled = await emailRepo.backfillRfcMessageIdsByExternalMessageId(
        channelId,
        rows.filter((row): row is NonNullable<typeof row> => row !== null),
      );
      if (backfilled > 0) {
        logger.info(`${TAG} backfilled RFC Message-ID for ${backfilled} already-ingested emails`);
      }
    } catch (error) {
      logger.warn(`${TAG} RFC Message-ID backfill for skipped emails failed`, { error });
    }
  }
}

export async function catchUpFromCursor(
  source: ExternalSource,
  adapter: ExternalSourceAdapter,
  startHistoryId: string,
): Promise<RefetchResult> {
  const google = GoogleService.fromEncryptedCredentials(source.credentials, source.id);
  const { messages, historyId } = await google.listMessageRefsFromHistory(startHistoryId);
  const existing = await externalMessageRepo.findByExternalIds(
    source.id,
    messages.map(m => m.id),
  );
  const pending = messages.filter(
    m => !existing.some(e => e.externalId === m.id && e.direction === MessageDirection.INCOMING),
  );

  const grouped = new Map<string, string[]>();
  for (const m of pending) {
    const ids = grouped.get(m.threadId);
    if (ids) ids.push(m.id);
    else grouped.set(m.threadId, [m.id]);
  }
  const threadGroups = Array.from(grouped.entries());

  logger.info(
    `${TAG} [CATCHUP] history returned ${messages.length}, ${pending.length} pending across ${threadGroups.length} threads`,
    { sourceName: source.name, startHistoryId, resolvedHistoryId: historyId },
  );

  let processed = 0;
  let newTickets = 0;
  let skipped = 0;
  const errors: string[] = [];

  const ingestThread = async (messageIds: string[]): Promise<void> => {
    for (const messageId of messageIds) {
      try {
        const messageData = await google.getMessageById(messageId);
        if (!messageData) {
          skipped += 1;
          continue;
        }
        if ((messageData.labelIds ?? []).includes('DRAFT')) {
          skipped += 1;
          continue;
        }

        const parsedEmail = google.parseEmailData(messageData);
        const preDownloadedAttachments = await preDownloadGmailAttachments({
          googleService: google,
          messageId,
          messageData,
          sourceName: source.name,
        });

        const parsed = await transformer.transform({
          parsedEmail: { ...parsedEmail, attachments: [] },
          ...(preDownloadedAttachments.length > 0 && { preDownloadedAttachments }),
        });
        if (!parsed.success || !parsed.data) throw new Error(parsed.error);

        const results = await externalSourceCore.sync(adapter, source.name, parsed.data, source);
        for (const result of results) {
          if (result.action === 'created') {
            processed += 1;
            if (result.isNew) newTickets += 1;
          } else if (result.action === 'updated') {
            processed += 1;
          } else {
            skipped += 1;
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`${TAG} [CATCHUP] message ${messageId} ingest failed`, { error: msg });
        errors.push(msg);
      }
    }
  };

  const { batchSize, batchDelayMs } = config.emailFetch;
  for (let i = 0; i < threadGroups.length; i += batchSize) {
    const batch = threadGroups.slice(i, i + batchSize);
    await Promise.all(batch.map(([, ids]) => ingestThread(ids)));

    if (batchDelayMs > 0 && i + batchSize < threadGroups.length) {
      await new Promise(resolve => setTimeout(resolve, batchDelayMs));
    }
  }

  if (historyId) {
    if (errors.length > 0) {
      logger.warn(`${TAG} [CURSOR_HELD] ${errors.length} message(s) failed — not advancing`, {
        sourceName: source.name,
        heldAt: source.lastSyncCursor,
        wouldHaveAdvancedTo: historyId,
      });
    } else {
      await advanceSyncCursor(source.id, historyId);
    }
  }

  logger.info(
    `${TAG} [CATCHUP] ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length}`,
  );
  return { processed, newTickets, skipped, errors };
}

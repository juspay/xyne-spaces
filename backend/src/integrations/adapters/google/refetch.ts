/**
 * Google Gmail fetch.
 * Fetch message ids (history since cursor, or latest 10 fallback),
 * ingest each through the existing sync pipeline, persist the new cursor.
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

const TAG = '[GoogleRefetch]';
const transformer = new GoogleTransformer();
const preferenceRepo = new EmailChannelPreferenceRepository();

export class GoogleRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    if (!options?.startDate || !options?.endDate) {
      throw new Error(
        '[GoogleRefetch] startDate and endDate are required — manual refetch is range-only',
      );
    }
    if (!source.channelId) {
      throw new Error(`[GoogleRefetch] source ${source.name} has no channel binding`);
    }

    const google = GoogleService.fromEncryptedCredentials(source.credentials, source.id);
    const preference = await preferenceRepo.findByChannelId(source.channelId);
    const userId = preference?.ownerUserId ?? source.displayName;

    // Step 1: list messages in the window
    const messages = await google.listMessagesByDateRange({
      startDate: options.startDate,
      endDate: options.endDate,
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
    const threadGroups = Array.from(grouped.entries()); // [threadId, messageIds[]]

    // Step 3: process threads in parallel up to batchSize, but each
    // thread's messages flow into a single ingestEmailThread call.
    let processed = 0;
    let newTickets = 0;
    let skipped = 0;
    const errors: string[] = [];

    const ingestThread = async (
      threadId: string,
      messageIds: string[],
    ): Promise<void> => {
      try {
        const fetched = await Promise.all(
          messageIds.map(async id => {
            const messageData = await google.getMessageById(id);
            if (!messageData) return null;

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

        const validParsed = fetched.filter(
          (d): d is NonNullable<typeof d> =>
            d !== null && !!d.data.emailData?.from && !!d.data.emailData?.to,
        );
        if (validParsed.length === 0) return;

        const result = await emailService.ingestEmailThread({
          channelId: source.channelId!,
          externalThreadId: threadId,
          externalSourceId: source.id,
          userId,
          ticketMetadata: validParsed[0]!.data.metadata,
          emails: validParsed.map(({ data: d, uploadedFiles }) => ({
            externalMessageId: d.externalId,
            subject: d.emailData!.subject ?? '',
            body: d.content,
            from: d.emailData!.from!,
            to: d.emailData!.to ?? [],
            cc: d.emailData!.cc ?? [],
            bcc: d.emailData!.bcc ?? [],
            receivedAt: d.metadata.timestamp,
            uploadedFiles,
          })),
        });

        processed += result.inserted;
        skipped += result.duplicates;
        if (result.isNew) newTickets += 1;
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


    logger.info(`${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length}`);
    return { processed, newTickets, skipped, errors };
  }
}

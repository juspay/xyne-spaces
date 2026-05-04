/**
 * Microsoft Graph refetch.
 * Fetch message ids (incremental by receivedDateTime, or latest 10 fallback),
 * ingest each through the existing sync pipeline, persist the new cursor.
 */

import { ExternalSource } from '@prisma/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { MicrosoftDeskService } from '@/services/microsoftDeskService';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { MicrosoftTransformer } from './transformer';
import { preDownloadGraphAttachments } from './attachments';
import { GraphMailMessage } from './types';
import { emailService } from '@/services/emailService';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { AttachmentConversionService } from '@/services/externalAttachmentService';

const TAG = '[MicrosoftRefetch]';
const RANGE_MAX_MESSAGES = 2000;
const transformer = new MicrosoftTransformer();
const preferenceRepo = new EmailChannelPreferenceRepository();

const GRAPH_MESSAGE_FIELDS = [
  'id', 'subject', 'body', 'bodyPreview', 'from',
  'toRecipients', 'ccRecipients', 'bccRecipients', 'replyTo',
  'conversationId', 'internetMessageId', 'receivedDateTime',
  'hasAttachments', 'parentFolderId',
].join(',');

type GraphMessageStub = { id: string; receivedDateTime: string; conversationId?: string };

export class MicrosoftRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    if (!options?.startDate || !options?.endDate) {
      throw new Error(
        '[MicrosoftRefetch] startDate and endDate are required — manual refetch is range-only',
      );
    }
    if (!source.channelId) {
      throw new Error(`[MicrosoftRefetch] source ${source.name} has no channel binding`);
    }

    const accessToken = await MicrosoftDeskService.getValidAccessToken(source.credentials, source.id);
    const preference = await preferenceRepo.findByChannelId(source.channelId);
    const userId = preference?.ownerUserId ?? source.displayName;

    // Step 1: list message ids in the window.
    const value = await this.listMessagesInRange(
      accessToken,
      options.startDate,
      options.endDate,
    );
    logger.info(`${TAG} range listing returned ${value.length} messages`, {
      startDate: options.startDate,
      endDate: options.endDate,
      firstReceived: value[0]?.receivedDateTime,
      lastReceived: value[value.length - 1]?.receivedDateTime,
      distinctThreads: new Set(value.map(m => m.conversationId ?? m.id)).size,
    });

    // Step 2: group by conversationId.
    const groupedByThread = new Map<string, GraphMessageStub[]>();
    for (const m of value) {
      const threadId = m.conversationId ?? m.id;
      const bucket = groupedByThread.get(threadId);
      if (bucket) bucket.push(m);
      else groupedByThread.set(threadId, [m]);
    }

    // Step 3: process threads in parallel up to batchSize. Each thread's
    // messages flow into a single ingestEmailThread call.
    let processed = 0;
    let newTickets = 0;
    let skipped = 0;
    const errors: string[] = [];

    const ingestThread = async (
      threadId: string,
      stubs: GraphMessageStub[],
    ): Promise<void> => {
      try {
        const sortedIds = stubs
          .slice()
          .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))
          .map(s => s.id);

        const fetched = await Promise.all(
          sortedIds.map(async id => {
            const msgResponse = await fetch(
              `${config.microsoftGraph.baseUrl}/me/messages/${id}?$select=${GRAPH_MESSAGE_FIELDS}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (!msgResponse.ok) throw new Error(`fetch message ${id}: ${msgResponse.status}`);
            const email = (await msgResponse.json()) as GraphMailMessage;

            const preDownloadedAttachments = email.hasAttachments
              ? await preDownloadGraphAttachments({
                  accessToken,
                  graphMessageId: id,
                  sourceName: source.name,
                })
              : [];

            const parsed = await transformer.transform({
              emails: [email],
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
          d => !!d.data.emailData?.from && !!d.data.emailData?.to,
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
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`${TAG} thread ${threadId} ingest failed`, { error: errMsg });
        errors.push(errMsg);
      }
    };

    const { batchSize, batchDelayMs } = config.emailFetch;
    const threadEntries = Array.from(groupedByThread.entries());
    for (let i = 0; i < threadEntries.length; i += batchSize) {
      const batch = threadEntries.slice(i, i + batchSize);
      await Promise.all(batch.map(([threadId, stubs]) => ingestThread(threadId, stubs)));
      if (batchDelayMs > 0 && i + batchSize < threadEntries.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }


    logger.info(`${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length}`);
    return { processed, newTickets, skipped, errors };
  }

  private async listMessagesInRange(
    accessToken: string,
    startDate: string,
    endDate: string,
  ): Promise<GraphMessageStub[]> {
    const filter = `receivedDateTime ge ${startDate} and receivedDateTime le ${endDate}`;
    const initialUrl = new URL(`${config.microsoftGraph.baseUrl}/me/messages`);
    initialUrl.searchParams.set('$filter', filter);
    initialUrl.searchParams.set('$orderby', 'receivedDateTime asc');
    initialUrl.searchParams.set('$select', 'id,receivedDateTime,conversationId');
    initialUrl.searchParams.set('$top', '100');

    const collected: GraphMessageStub[] = [];
    let nextLink: string | undefined = initialUrl.toString();

    while (nextLink && collected.length < RANGE_MAX_MESSAGES) {
      const response = await fetch(nextLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Failed to list messages: ${response.status} ${body}`);
      }
      const json = (await response.json()) as {
        value: GraphMessageStub[];
        '@odata.nextLink'?: string;
      };
      for (const m of json.value ?? []) {
        collected.push(m);
        if (collected.length >= RANGE_MAX_MESSAGES) break;
      }
      nextLink = json['@odata.nextLink'];
    }

    return collected;
  }
}

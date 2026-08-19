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
import { graphFetchWithRetry } from './graphFetch';
import { GraphMailMessage } from './types';
import { emailService } from '@/services/emailService';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { AttachmentConversionService } from '@/services/externalAttachmentService';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { emailMatchesDl } from '@/services/dlResolver';
import { normalizeRfcMessageId, normalizeRfcMessageIds } from '@/utils/emailRfcMessageId';

const TAG = '[MicrosoftRefetch]';
const RANGE_MAX_MESSAGES = 2000;
const transformer = new MicrosoftTransformer();
const preferenceRepo = new EmailChannelPreferenceRepository();
const channelRepo = new ChannelRepository();
const emailRepo = new EmailRepository();

const GRAPH_MESSAGE_FIELDS = [
  'id', 'subject', 'body', 'bodyPreview', 'from',
  'toRecipients', 'ccRecipients', 'bccRecipients', 'replyTo',
  'conversationId', 'internetMessageId',
  'receivedDateTime', 'hasAttachments', 'parentFolderId',
  'internetMessageHeaders',
].join(',');

type GraphRecipient = { emailAddress?: { address?: string } };
type GraphMessageStub = {
  id: string;
  receivedDateTime: string;
  conversationId?: string;
  internetMessageId?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
};

function stubToDlInput(stub: GraphMessageStub): { from?: string; to?: string[]; cc?: string[] } {
  return {
    from: stub.from?.emailAddress?.address,
    to: (stub.toRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
    cc: (stub.ccRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
  };
}

export class MicrosoftRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    if (!options?.startDate || !options?.endDate) {
      throw new Error(
        '[MicrosoftRefetch] startDate and endDate are required — manual refetch is range-only',
      );
    }

    const ingestChannelId = options.targetChannelId ?? source.channelId;
    if (!ingestChannelId) {
      throw new Error(`[MicrosoftRefetch] source ${source.name} has no channel to ingest into`);
    }

    const accessToken = await MicrosoftDeskService.getValidAccessToken(source.credentials, source.id);
    const preference = await preferenceRepo.findByChannelId(ingestChannelId);
    const userId = preference?.ownerUserId ?? source.displayName;

    // For DL desks: routing key is `dlEmail` appearing in From / To / Cc.
    // Microsoft classic DGs don't emit List-ID, so we anchor on visible
    // sender/recipient headers only. Messages with no match are silently dropped.
    const targetDl = options.dlEmail?.toLowerCase() ?? null;

    // Step 1: list message ids in the window.
    const value = await this.listMessagesInRange(
      accessToken,
      options.startDate,
      options.endDate,
      targetDl,
      targetDl ? null : RANGE_MAX_MESSAGES,
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

    const stubLookupId = (s: GraphMessageStub): string => s.internetMessageId ?? s.id;
    const allLookupIds = Array.from(groupedByThread.values()).flatMap(stubs =>
      stubs.map(stubLookupId),
    );
    if (allLookupIds.length > 0) {
      const existing = await emailRepo.findExistingExternalMessageIds(allLookupIds, ingestChannelId);
      if (existing.length > 0) {
        const existingSet = new Set(existing);
        const backfilled = await emailRepo.backfillRfcMessageIdsByExternalMessageId(
          ingestChannelId,
          Array.from(groupedByThread.values())
            .flat()
            .filter(s => existingSet.has(stubLookupId(s)))
            .map(s => ({
              externalMessageId: stubLookupId(s),
              rfcMessageId: s.internetMessageId,
            })),
        );
        if (backfilled > 0) {
          logger.info(`${TAG} backfilled RFC Message-ID for ${backfilled} already-ingested emails`);
        }
        let skippedBeforeFetch = 0;
        for (const [threadId, stubs] of Array.from(groupedByThread.entries())) {
          const remaining = stubs.filter(s => !existingSet.has(stubLookupId(s)));
          skippedBeforeFetch += stubs.length - remaining.length;
          if (remaining.length === 0) groupedByThread.delete(threadId);
          else if (remaining.length !== stubs.length) groupedByThread.set(threadId, remaining);
        }
        logger.info(
          `${TAG} pre-dedup: skipped ${skippedBeforeFetch} already-ingested messages; ${groupedByThread.size} threads remain`,
        );
      }
    }

    if (options?.dlEmail && ingestChannelId && groupedByThread.size > 0) {
      const allInternetMsgIds = Array.from(groupedByThread.values())
        .flatMap(stubs => stubs.map(s => s.internetMessageId).filter(Boolean) as string[]);
      const normalizedInternetMsgIds = normalizeRfcMessageIds(allInternetMsgIds);

      if (allInternetMsgIds.length > 0) {
        // Dedupe has to see every already-ingested message, so it runs above the caller's own scope.
        const existingInChannel = await withWorkspaceScope(() =>
          db.email.findMany({
            where: {
              channelId: ingestChannelId,
              OR: [
                ...(normalizedInternetMsgIds.length > 0 ? [{ rfcMessageId: { in: normalizedInternetMsgIds } }] : []),
                { externalMessageId: { in: allInternetMsgIds } },
              ],
            },
            select: { externalMessageId: true, rfcMessageId: true, externalThreadId: true },
          }),
        );
        if (existingInChannel.length > 0) {
          // Map: internetMessageId → channel's externalThreadId
          const msgIdToChannelThreadId = new Map<string, string>();
          for (const e of existingInChannel) {
            if (e.rfcMessageId && e.externalThreadId) {
              msgIdToChannelThreadId.set(e.rfcMessageId, e.externalThreadId);
            }
            if (e.externalMessageId && e.externalThreadId) {
              msgIdToChannelThreadId.set(e.externalMessageId, e.externalThreadId);
            }
          }

          const remapped = new Map<string, GraphMessageStub[]>();
          let remappedCount = 0;
          let skippedCount = 0;

          for (const [memberThreadId, stubs] of Array.from(groupedByThread.entries())) {
            let channelThreadId: string | null = null;
            for (const s of stubs) {
              const normalizedInternetMessageId = normalizeRfcMessageId(s.internetMessageId);
              const lookupIds = [
                ...(normalizedInternetMessageId ? [normalizedInternetMessageId] : []),
                ...(s.internetMessageId && s.internetMessageId !== normalizedInternetMessageId ? [s.internetMessageId] : []),
              ];
              const matchedId = lookupIds.find(id => msgIdToChannelThreadId.has(id));
              if (matchedId) {
                channelThreadId = msgIdToChannelThreadId.get(matchedId)!;
                break;
              }
            }

            if (channelThreadId) {
              const existing = remapped.get(channelThreadId) ?? [];
              const existingIds = new Set(existing.map(s => s.internetMessageId).filter((id): id is string => !!id));
              const newStubs = stubs.filter(s => !(s.internetMessageId && existingIds.has(s.internetMessageId)));

              if (newStubs.length > 0) {
                remapped.set(channelThreadId, [...existing, ...newStubs]);
                remappedCount++;
              } else {
                skippedCount++;
              }
            } else {
              remapped.set(memberThreadId, stubs);
            }
          }

          groupedByThread.clear();
          for (const [k, v] of remapped) groupedByThread.set(k, v);

          logger.info(
            `${TAG} DL cross-source thread dedup: remapped ${remappedCount} threads, skipped ${skippedCount} empty; ${groupedByThread.size} remain`,
            { channelId: ingestChannelId },
          );
        }
      }
    }

    // Step 3: process threads in parallel up to batchSize. Each thread's
    // messages flow into a single ingestEmailThread call.
    let processed = 0;
    let newTickets = 0;
    let skipped = 0;
    let threadsNeedingUnreadBump = 0;
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

        const fetched = [];
        for (const id of sortedIds) {
          const msgResponse = await graphFetchWithRetry(
            `${config.microsoftGraph.baseUrl}/me/messages/${id}?$select=${GRAPH_MESSAGE_FIELDS}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!msgResponse.ok) throw new Error(`fetch message ${id}: ${msgResponse.status}`);
          const email = (await msgResponse.json()) as GraphMailMessage;
          logger.info(`${TAG} fetched new email for channel ${ingestChannelId}`, { messageId: id, threadId });

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
          fetched.push({
            data: parsed.data,
            uploadedFiles:
              AttachmentConversionService.convertDownloadedToUploaded(preDownloadedAttachments),
          });
        }

        const validParsed = fetched.filter(
          d => !!d.data.emailData?.from && !!d.data.emailData?.to,
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
        if (result.inserted > 0 && !result.wasVespaMerge) {
          threadsNeedingUnreadBump += 1;
        }
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

    logger.info(`${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length}`);
    return { processed, newTickets, skipped, errors };
  }

  private async listMessagesInRange(
    accessToken: string,
    startDate: string,
    endDate: string,
    targetDl: string | null,
    maxMessages: number | null,
  ): Promise<GraphMessageStub[]> {
    const selectFields = targetDl
      ? 'id,receivedDateTime,conversationId,internetMessageId,from,toRecipients,ccRecipients'
      : 'id,receivedDateTime,conversationId,internetMessageId';

    const initialUrl = new URL(`${config.microsoftGraph.baseUrl}/me/messages`);
    initialUrl.searchParams.set(
      '$filter',
      `receivedDateTime ge ${startDate} and receivedDateTime le ${endDate}`,
    );
    initialUrl.searchParams.set('$orderby', 'receivedDateTime asc');
    initialUrl.searchParams.set('$select', selectFields);
    initialUrl.searchParams.set('$top', '100');

    const collected: GraphMessageStub[] = [];
    let nextLink: string | undefined = initialUrl.toString();
    let droppedNoMatch = 0;

    while (nextLink && (maxMessages === null || collected.length < maxMessages)) {
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
        if (targetDl && !emailMatchesDl(stubToDlInput(m), targetDl)) {
          droppedNoMatch += 1;
          continue;
        }
        collected.push(m);
        if (maxMessages !== null && collected.length >= maxMessages) break;
      }
      nextLink = json['@odata.nextLink'];
    }

    if (targetDl) {
      logger.info(`${TAG} DL recipient/from filter`, {
        targetDl,
        matched: collected.length,
        dropped: droppedNoMatch,
      });
    }
    return collected;
  }
}

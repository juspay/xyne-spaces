/**
 * Microsoft Graph refetch.
 * Fetch message ids (incremental by receivedDateTime, or latest 10 fallback),
 * ingest each through the existing sync pipeline, persist the new cursor.
 */

import { ExternalSource } from '@prisma/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { MicrosoftDeskService } from '@/services/microsoftDeskService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { externalSourceCore } from '../../core/core';
import { adapterRegistry } from '../../core/adapterRegistry';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { ExternalSourcePlatform } from '../../core/types';
import { MicrosoftTransformer } from './transformer';
import { preDownloadGraphAttachments } from './attachments';
import { GraphMailMessage } from './types';

const TAG = '[MicrosoftRefetch]';
const FALLBACK_LIMIT = 10;
const RANGE_MAX_MESSAGES = 2000;
const transformer = new MicrosoftTransformer();

const GRAPH_MESSAGE_FIELDS = [
  'id', 'subject', 'body', 'bodyPreview', 'from',
  'toRecipients', 'ccRecipients', 'bccRecipients', 'replyTo',
  'conversationId', 'internetMessageId', 'receivedDateTime',
  'hasAttachments', 'parentFolderId',
].join(',');

type GraphMessageStub = { id: string; receivedDateTime: string; conversationId?: string };

export class MicrosoftRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    const accessToken = await MicrosoftDeskService.getValidAccessToken(source.credentials, source.id);

    const isRangeMode = !!(options?.startDate && options?.endDate);

    // Step 1: list message ids
    let value: GraphMessageStub[];

    if (isRangeMode) {
      value = await this.listMessagesInRange(accessToken, options!.startDate!, options!.endDate!);
    } else {
      const listUrl = new URL(`${config.microsoftGraph.baseUrl}/me/messages`);
      if (source.lastSyncCursor) {
        listUrl.searchParams.set('$filter', `receivedDateTime gt ${source.lastSyncCursor}`);
        listUrl.searchParams.set('$orderby', 'receivedDateTime asc');
      } else {
        listUrl.searchParams.set('$orderby', 'receivedDateTime desc');
        // Over-fetch then thread-cap below so N=10 = 10 tickets, not 10 raw messages.
        listUrl.searchParams.set('$top', String(FALLBACK_LIMIT * 10));
      }
      listUrl.searchParams.set('$select', 'id,receivedDateTime,conversationId');

      const listResponse = await fetch(listUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!listResponse.ok) {
        const body = await listResponse.text().catch(() => '');
        throw new Error(`Failed to list messages: ${listResponse.status} ${body}`);
      }
      const rawValue = ((await listResponse.json()) as { value: GraphMessageStub[] }).value ?? [];

      value = rawValue;
      if (!source.lastSyncCursor) {
        const picked: GraphMessageStub[] = [];
        const threads = new Set<string>();
        for (const m of rawValue) {
          const tid = m.conversationId ?? m.id;
          if (threads.size >= FALLBACK_LIMIT && !threads.has(tid)) continue;
          threads.add(tid);
          picked.push(m);
        }
        value = picked;
      }
    }

    const nextCursor = value.reduce<string | null>(
      (acc, m) => (!acc || m.receivedDateTime > acc ? m.receivedDateTime : acc),
      source.lastSyncCursor ?? null,
    );

    // Step 2: ingest each — fetch full message, transform, sync
    let processed = 0;
    let newTickets = 0;
    let skipped = 0;
    const errors: string[] = [];

    const ingestOne = async (id: string): Promise<void> => {
      try {
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

        const result = await externalSourceCore.sync(
          adapterRegistry.getAdapter(ExternalSourcePlatform.MICROSOFT),
          source.name,
          parsed.data,
        );
        if (result.action === 'duplicate') {
          skipped++;
        } else {
          processed++;
          if (result.isNew) newTickets++;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`${TAG} ingest failed for ${id}`, { error: errMsg });
        errors.push(errMsg);
      }
    };

    const { batchSize, batchDelayMs } = config.emailFetch;
    const ids = value.map(v => v.id);
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await Promise.all(batch.map(ingestOne));
      if (batchDelayMs > 0 && i + batchSize < ids.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }

    // Step 3: persist cursor
    if (nextCursor && nextCursor > (source.lastSyncCursor ?? '')) {
      await new ExternalSourceRepository().update(source.id, { lastSyncCursor: nextCursor });
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

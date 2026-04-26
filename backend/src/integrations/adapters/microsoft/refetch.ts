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
import { BaseRefetch, RefetchResult } from '../../core/baseRefetch';
import { ExternalSourcePlatform } from '../../core/types';
import { MicrosoftTransformer } from './transformer';
import { preDownloadGraphAttachments } from './attachments';
import { GraphMailMessage } from './types';

const TAG = '[MicrosoftRefetch]';
const FALLBACK_LIMIT = 10;
const transformer = new MicrosoftTransformer();

const GRAPH_MESSAGE_FIELDS = [
  'id', 'subject', 'body', 'bodyPreview', 'from',
  'toRecipients', 'ccRecipients', 'bccRecipients', 'replyTo',
  'conversationId', 'internetMessageId', 'receivedDateTime',
  'hasAttachments', 'parentFolderId',
].join(',');

export class MicrosoftRefetch extends BaseRefetch {
  async refetch(source: ExternalSource): Promise<RefetchResult> {
    const accessToken = await MicrosoftDeskService.getValidAccessToken(source.credentials, source.id);

    // Step 1: list recent ids
    const listUrl = new URL(`${config.microsoftGraph.baseUrl}/me/messages`);
    if (source.lastSyncCursor) {
      listUrl.searchParams.set('$filter', `receivedDateTime gt ${source.lastSyncCursor}`);
      listUrl.searchParams.set('$orderby', 'receivedDateTime asc');
    } else {
      listUrl.searchParams.set('$orderby', 'receivedDateTime desc');
      listUrl.searchParams.set('$top', String(FALLBACK_LIMIT));
    }
    listUrl.searchParams.set('$select', 'id,receivedDateTime');

    const listResponse = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listResponse.ok) {
      const body = await listResponse.text().catch(() => '');
      throw new Error(`Failed to list messages: ${listResponse.status} ${body}`);
    }
    const { value = [] } = (await listResponse.json()) as {
      value: Array<{ id: string; receivedDateTime: string }>;
    };
    const nextCursor = value.reduce<string | null>(
      (acc, m) => (!acc || m.receivedDateTime > acc ? m.receivedDateTime : acc),
      source.lastSyncCursor ?? null,
    );

    // Step 2: ingest each — fetch full message, transform, sync
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const { id } of value) {
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
        if (result.action === 'duplicate') skipped++;
        else processed++;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`${TAG} ingest failed for ${id}`, { error: errMsg });
        errors.push(errMsg);
      }
    }

    // Step 3: persist cursor
    if (nextCursor && nextCursor !== source.lastSyncCursor) {
      await new ExternalSourceRepository().update(source.id, { lastSyncCursor: nextCursor });
    }

    logger.info(`${TAG} ${source.name}: processed=${processed} skipped=${skipped} errors=${errors.length}`);
    return { processed, skipped, errors };
  }
}

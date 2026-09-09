/**
 * App Desk refetch — pulls historical tickets from a Xyne App's export API
 * (GET {webhookUrl}/export/messages) into its desk channel.
 *
 * Persistence deliberately reuses the exact two calls of POST
 * /api/apps/tickets/appDeskInbound (emailService.createConversationWithEmail /
 * addEmailToConversation with the same deskSource ticketMetadata, the same
 * source-scoped externalMessageId, and the same ExternalMessage thread link),
 * so a pulled message's rows are identical to a live inbound app's rows. The
 * generic externalSourceCore ingest was rejected: app-desk has no NormalizedData
 * producer and its thread-continuation/foreign-claim rules live in
 * appDeskInbound, not in the generic pipeline.
 */

import { ExternalSource, Prisma } from '@prisma/client';
import { EmailType, ExternalEntityType } from '@xyne/shared';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { resolveAppDeskInstalledAppId, scopeExternalMessageIdToSource } from '../../core/deskSources';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { repositories } from '@/database/repositories';
import { ExternalSourceRepository, MAILBOX_SOURCE_TYPES } from '@/database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { emailService } from '@/services/emailService';
import { extractEmailAddress } from '@/utils/email';
import { prepareAppWebhookDispatch } from '@/apps/core/appUrlResolver';
import { safeWebhookFetch } from '@/utils/ssrfGuard';
import { buildSignedAppRequestHeaders } from '@/apps/core/webhookRequestSigner';
import { AppDeskExportMessage, AppDeskExportPage } from './types';
import { AppDeskExportError } from './errors';

const TAG = '[AppDeskRefetch]';
const PAGE_SIZE = 200;
const MAX_PAGES = 500;
// Per-page cap plus an overall wall-clock budget sized under the Bull lock,
// so a hung app can't stall the shared refetch processor.
const PAGE_TIMEOUT_MS = 30_000;
const EXPORT_WALL_CLOCK_MS = 8 * 60_000;

const externalSourceRepo = new ExternalSourceRepository();
const externalMessageRepo = new ExternalMessageRepository();

interface IngestContext {
  source: ExternalSource;
  channelId: string;
  userId: string;
  recipientEmail: string;
  installedAppId: string;
  ownerUser: { name: string; email: string } | null;
}

export class AppDeskRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    if (!options?.startDate || !options?.endDate) {
      throw new AppDeskExportError(
        `${TAG} startDate and endDate are required — manual refetch is range-only`,
      );
    }

    const channelId = source.channelId;
    if (!channelId) {
      throw new AppDeskExportError(
        `${TAG} source ${source.name} has no channel to ingest into`,
      );
    }

    const installedAppId = resolveAppDeskInstalledAppId(source);
    if (!installedAppId) {
      throw new AppDeskExportError(
        `${TAG} source ${source.name} is missing its backing install`,
      );
    }
    const installedApp = await db.installedApps.findUnique({
      where: { id: installedAppId },
      select: { webhookUrl: true, app: { select: { signingSecret: true } } },
    });
    if (!installedApp) {
      throw new AppDeskExportError(
        `${TAG} the app backing source ${source.name} no longer exists (install ${installedAppId})`,
      );
    }
    if (!installedApp.webhookUrl?.trim()) {
      throw new AppDeskExportError(
        `${TAG} app backing source ${source.name} has no webhook URL — cannot export`,
      );
    }
    if (!installedApp.app?.signingSecret) {
      throw new AppDeskExportError(
        `${TAG} app backing source ${source.name} has no signing secret — cannot authenticate export`,
      );
    }
    const signingSecret = decrypt(installedApp.app.signingSecret);
    const baseUrl = installedApp.webhookUrl.replace(/\/+$/, '');

    // Same recipient-address derivation as appDeskInbound: the desk's own
    // address comes from its mailbox source/preference, never the app binding.
    // Same hard gate too: inbound returns 503 MISCONFIGURED without a board.
    const preference = await db.emailChannelPreference.findUnique({
      where: { channelId },
      select: { sendAsEmail: true, ownerUserId: true, boardId: true },
    });
    if (!preference?.boardId) {
      throw new AppDeskExportError(
        `${TAG} channel ${channelId} has no desk board configured (email_channel_preferences.boardId)`,
      );
    }
    if (!preference.ownerUserId) {
      throw new AppDeskExportError(
        `${TAG} channel ${channelId} has no desk owner configured (email_channel_preferences.ownerUserId)`,
      );
    }
    const ownerUser = preference?.ownerUserId
      ? await repositories.users.findById(preference.ownerUserId)
      : null;
    const mailboxSource = await externalSourceRepo.findChannelSource(channelId, {
      sourceTypes: [...MAILBOX_SOURCE_TYPES],
    });
    const recipientEmail =
      preference?.sendAsEmail ||
      extractEmailAddress(mailboxSource?.displayName ?? '') ||
      ownerUser?.email ||
      `desk-${channelId}@apps.xyne.ai`;

    const ctx: IngestContext = {
      source,
      channelId,
      userId: preference.ownerUserId,
      recipientEmail,
      installedAppId,
      ownerUser: ownerUser ? { name: ownerUser.name, email: ownerUser.email } : null,
    };

    let processed = 0;
    let newTickets = 0;
    let skipped = 0;
    const errors: string[] = [];

    let cursor: string | undefined;
    let pageCount = 0;
    const deadline = Date.now() + EXPORT_WALL_CLOCK_MS;

    // Sequential pagination: the export is oldest-first with a monotonic
    // cursor, so pages (and messages within a page) ingest strictly in order.
    while (true) {
      if (Date.now() > deadline) {
        const msg = `export budget ${EXPORT_WALL_CLOCK_MS}ms exceeded after ${pageCount} pages — stopping before the Bull lock expires`;
        logger.warn(`${TAG} ${msg}`, { sourceId: source.id, channelId });
        errors.push(msg);
        break;
      }
      const page = await this.fetchPage(baseUrl, signingSecret, options.startDate, options.endDate, cursor);
      pageCount += 1;

      for (const message of page.messages) {
        try {
          const outcome = await this.ingestMessage(ctx, message);
          if (outcome === 'skipped') skipped += 1;
          else {
            processed += 1;
            if (outcome === 'created') newTickets += 1;
          }
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            skipped += 1;
            continue;
          }
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn(`${TAG} message ingest failed`, {
            sourceId: source.id,
            externalId: message.externalId,
            error: msg,
          });
          errors.push(msg);
        }
      }

      if (!page.nextCursor) break;
      if (pageCount >= MAX_PAGES) {
        const msg = `hard page cap ${MAX_PAGES} hit mid-export — nothing after this page ingested`;
        logger.warn(`${TAG} ${msg}`, { sourceId: source.id, startDate: options.startDate, endDate: options.endDate });
        errors.push(msg);
        break;
      }
      cursor = page.nextCursor;
    }

    logger.info(
      `${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length} pages=${pageCount}`,
      { channelId, startDate: options.startDate, endDate: options.endDate },
    );
    return { processed, newTickets, skipped, errors };
  }

  /** One signed GET against the app's export API; 429/5xx/transport are retryable, other 4xx permanent. */
  private async fetchPage(
    baseUrl: string,
    signingSecret: string,
    startDate: string,
    endDate: string,
    cursor: string | undefined,
  ): Promise<AppDeskExportPage> {
    const url = new URL(`${baseUrl}/export/messages`);
    url.searchParams.set('startDate', startDate);
    url.searchParams.set('endDate', endDate);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);

    url.searchParams.sort();
    const headers = buildSignedAppRequestHeaders({
      signingSecret,
      method: 'GET',
      pathWithQuery: `${url.pathname}${url.search}`,
    });
    headers['Accept'] = 'application/json';

    let response: Response;
    try {
      const dispatch = await prepareAppWebhookDispatch(url.toString(), headers);
      const init: RequestInit = {
        method: 'GET',
        headers: dispatch.headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      };
      response = dispatch.isInternal
        ? await fetch(dispatch.url, init)
        : await safeWebhookFetch(dispatch.url, init);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new AppDeskExportError(`${TAG} export request failed: ${msg}`);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new AppDeskExportError(
        `${TAG} export returned ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }

    let page: AppDeskExportPage;
    try {
      page = (await response.json()) as AppDeskExportPage;
    } catch {
      throw new AppDeskExportError(`${TAG} export response was not valid JSON`);
    }
    if (!page || !Array.isArray(page.messages)) {
      throw new AppDeskExportError(`${TAG} export response is missing the messages array`);
    }
    return page;
  }

  /** Mirror of appDeskInbound's persist path for one pulled message. */
  private async ingestMessage(ctx: IngestContext, message: AppDeskExportMessage): Promise<'created' | 'appended' | 'skipped'> {
    const { source, channelId } = ctx;
    if (!message.externalId) {
      throw new Error('export message is missing externalId');
    }
    const receivedAt = new Date(message.sentAt);
    if (Number.isNaN(receivedAt.getTime())) {
      throw new Error(`export message ${message.externalId} has an invalid sentAt`);
    }
    const externalThreadId = message.externalThreadId ?? message.externalId;
    const externalMessageId = scopeExternalMessageIdToSource(source.id, message.externalId);

    // ExternalMessage's (externalSourceId, externalId) unique key is the dedup.
    const existing = await externalMessageRepo.findByExternalId(source.id, externalMessageId);
    if (existing) return 'skipped';

    const senderEmail = message.sender?.email?.trim() || undefined;
    const senderName = message.sender?.name?.trim() || undefined;
    let emailFrom =
      (senderName && senderEmail && `${senderName} <${senderEmail}>`) ||
      senderName ||
      senderEmail ||
      '';
    if (!emailFrom) {
      emailFrom = ctx.ownerUser?.email
        ? `${ctx.ownerUser.name} <${ctx.ownerUser.email}>`
        : ctx.ownerUser?.name ?? 'External user';
    }
    const emailSubject = message.subject?.trim() || '(no subject)';
    const recipients = (message.recipients ?? []).map(r => r.trim()).filter(Boolean);
    const emailTo = recipients.length > 0 ? recipients : [ctx.recipientEmail];

    // Thread continuation is source-scoped via the app's ExternalMessage link;
    // the channel-scoped fallback only adopts threads no other source claims.
    const linkedMessage = await externalMessageRepo.findByThreadId(
      source.id,
      externalThreadId,
      ExternalEntityType.EMAIL,
    );
    let threadEmail = linkedMessage?.entityId
      ? await repositories.emails.findById(linkedMessage.entityId)
      : null;
    if (!threadEmail) {
      const candidate = await repositories.emails.findFirstByThreadAndChannel(externalThreadId, channelId);
      if (candidate) {
        const conversationEmails = await repositories.emails.findByConversationId(candidate.conversationId);
        const foreignLink = await externalMessageRepo.findForeignLinkByEmailIds(
          conversationEmails.map(e => e.id),
          source.id,
        );
        if (foreignLink) {
          logger.info(`${TAG} thread id collides with another source on this channel — starting a new ticket`, {
            channelId,
            threadId: externalThreadId,
            externalSourceId: source.id,
            ownedByExternalSourceId: foreignLink.externalSourceId,
          });
        } else {
          threadEmail = candidate;
        }
      }
    }

    if (threadEmail) {
      await emailService.addEmailToConversation({
        conversationId: threadEmail.conversationId,
        emailSubject,
        emailBody: message.body ?? '',
        emailTo,
        emailFrom,
        externalSourceId: source.id,
        externalThreadId,
        externalMessageId,
        emailType: EmailType.DEFAULT,
        receivedAt,
      });
      return 'appended';
    }

    const result = await emailService.createConversationWithEmail({
      channelId,
      userId: ctx.userId,
      emailSubject,
      emailBody: message.body ?? '',
      emailFrom,
      emailTo,
      externalSourceId: source.id,
      externalThreadId,
      externalMessageId,
      ticketMetadata: {
        deskSource: {
          type: 'app',
          installedAppId: ctx.installedAppId,
          appName: source.displayName ?? ctx.installedAppId,
        },
        ...(senderEmail && {
          reporterEmail: extractEmailAddress(senderEmail) ?? senderEmail.toLowerCase(),
          fromEmailAddress: senderEmail,
        }),
      },
      receivedAt,
    });
    if ('isDuplicate' in result && result.isDuplicate) return 'skipped';
    return 'created';
  }
}

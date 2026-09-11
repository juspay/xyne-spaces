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
import { config } from '@/config/env';
import { AppDeskExportMessage, AppDeskExportPage } from './types';
import { AppDeskExportError, AppDeskExportThrottledError } from './errors';

const TAG = '[AppDeskRefetch]';
const PAGE_SIZE = 200;
const MAX_PAGES = 500;
// Per-page cap plus an overall wall-clock budget sized under the Bull lock,
// so a hung app can't stall the shared refetch processor.
const PAGE_TIMEOUT_MS = 30_000;
const EXPORT_WALL_CLOCK_MS = 8 * 60_000;
// The summary's errors tail is display-only; the true count goes to totalErrors.
const MAX_SUMMARY_ERRORS = 100;
// Upper bound on concurrently parked resume cursors (see ExportResumeCursor).
const MAX_RESUME_WINDOWS = 5;
// How many threads ingest concurrently within one page. Shares the knob the
// Gmail range refetch uses — same kind of dial (ingest fan-out), so one env
// var tunes both. Floored at 1 so a misconfigured 0 can't stall the loop.
const ingestBatchSize = (): number => Math.max(1, config.emailFetch.batchSize);
// Throttle backoff. Pages are fetched back-to-back — ingest no longer paces
// them — so a throttled page is retried in place rather than thrown: failing
// the job would have Bull replay every earlier page straight back into the
// limit the app just reported.
const MAX_THROTTLE_RETRIES = 5;
const THROTTLE_BACKOFF_BASE_MS = 1_000;

const externalSourceRepo = new ExternalSourceRepository();
const externalMessageRepo = new ExternalMessageRepository();

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** `Retry-After` is either delta-seconds or an HTTP-date; both are in the wild. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return null;
}

/**
 * Group a page's messages by thread, preserving the export's oldest-first
 * order inside each group. Messages of one thread must ingest sequentially —
 * they race on the same find-thread-then-create read/write in ingestMessage —
 * while separate threads never touch the same conversation and can run
 * together. Same shape as GoogleRefetch's threadGroups.
 */
function groupPageByThread(messages: AppDeskExportMessage[]): AppDeskExportMessage[][] {
  const groups = new Map<string | undefined, AppDeskExportMessage[]>();
  for (const message of messages) {
    const key = message.externalThreadId ?? message.externalId;
    const existing = groups.get(key);
    if (existing) existing.push(message);
    else groups.set(key, [message]);
  }
  return [...groups.values()];
}

interface ExportResumeCursor {
  /** Opaque export cursor identifying the next unfetched page. */
  cursor: string;
  /** Pages ingested in this window across all resumed runs (log-only). */
  pageCount: number;
  /** Epoch ms when the cursor was parked — eviction ordering. */
  parkedAt: number;
}

type ResumeCursorMap = Record<string, ExportResumeCursor>;

/** Key under which a window's cursor is parked in the cursor map. */
const windowKey = (startDate: string, endDate: string): string => `${startDate}|${endDate}`;

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
    // webhookUrl is user-provided and only ever validated as z.string().url() —
    // a query/fragment on it would poison the export URL built in fetchPage.
    let baseUrl: string;
    try {
      const parsed = new URL(installedApp.webhookUrl.trim());
      parsed.search = '';
      parsed.hash = '';
      baseUrl = parsed.toString().replace(/\/+$/, '');
    } catch {
      throw new AppDeskExportError(
        `${TAG} app backing source ${source.name} has an invalid webhook URL — cannot export`,
      );
    }

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
    let totalErrors = 0;
    const recordError = (msg: string) => {
      totalErrors += 1;
      if (errors.length < MAX_SUMMARY_ERRORS) errors.push(msg);
    };

    // One thread's messages, oldest first. Sequential by design — see
    // groupPageByThread. A failure is recorded and the thread continues, so
    // one bad message can't drop the rest of its conversation.
    const ingestThread = async (messages: AppDeskExportMessage[]): Promise<void> => {
      for (const message of messages) {
        try {
          const outcome = await this.ingestMessage(ctx, message);
          if (outcome === 'skipped') skipped += 1;
          else if (outcome === 'failed') {
            const msg = `export message ${message.externalId} was not persisted (blocked by configuration or empty persist result)`;
            logger.warn(`${TAG} message ingest failed`, {
              sourceId: source.id,
              externalId: message.externalId,
              error: msg,
            });
            recordError(msg);
          } else {
            processed += 1;
            if (outcome === 'created') newTickets += 1;
          }
        } catch (error) {
          // A concurrent batch can lose the Email (externalMessageId, channelId)
          // unique race even though threads are disjoint — two apps on one desk
          // can carry the same id. Same meaning as the pre-check in
          // ingestMessage: already present, count it skipped.
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
          recordError(msg);
        }
      }
    };

    // A previous run stopped on one of the budgets below: resume THIS window
    // from its parked cursor. Other windows' parked cursors are left alone.
    const resume = this.readResumeCursor(source, options.startDate, options.endDate);
    if (resume) {
      logger.info(`${TAG} resuming window export from parked cursor (${resume.pageCount} pages already ingested)`, {
        sourceId: source.id,
        startDate: options.startDate,
        endDate: options.endDate,
      });
    }

    let cursor: string | undefined = resume?.cursor;
    let pageCount = 0;
    let capped = false;
    const deadline = Date.now() + EXPORT_WALL_CLOCK_MS;

    const windowStart = options.startDate;
    const windowEnd = options.endDate;
    const parkProgress = async (): Promise<void> => {
      const parkedCursor = cursor;
      if (!parkedCursor) return;
      await this.persistResumeCursor(source.id, windowStart, windowEnd, {
        cursor: parkedCursor,
        pageCount: (resume?.pageCount ?? 0) + pageCount,
        parkedAt: Date.now(),
      });
    };

    try {
      // Pagination stays sequential — page N+1's request needs page N's cursor.
      // Within a page, order is only guaranteed per thread (see
      // groupPageByThread); separate threads ingest concurrently.
      for (;;) {
        if (Date.now() > deadline) {
          const msg = `export budget ${EXPORT_WALL_CLOCK_MS}ms exceeded after ${pageCount} pages — stopping before the Bull lock expires`;
          logger.warn(`${TAG} ${msg}`, { sourceId: source.id, channelId });
          recordError(msg);
          capped = true;
          break;
        }

        let page: AppDeskExportPage;
        try {
          page = await this.fetchPage(
            baseUrl,
            signingSecret,
            options.startDate,
            options.endDate,
            cursor,
            deadline,
          );
        } catch (error) {
          // Throttled beyond what this run can wait out. Stop cleanly rather
          // than throwing: a failed job is silent to the user and Bull would
          // retry into the same limit seconds later. Reported as partial, so
          // the notification tells them to rerun.
          if (error instanceof AppDeskExportThrottledError) {
            logger.warn(`${TAG} ${error.message}`, { sourceId: source.id, channelId, pageCount });
            recordError(error.message);
            capped = true;
            break;
          }
          throw error;
        }
        pageCount += 1;

        // Ingest dominates a page's cost — one network round trip against up
        // to PAGE_SIZE persist paths, each several queries — so fan out across
        // threads the way GoogleRefetch does: group first, then batch. No
        // inter-batch delay (unlike the Gmail path's batchDelayMs): the
        // bottleneck here is our own database, not a third party's rate limit.
        const threadGroups = groupPageByThread(page.messages);
        const batchSize = ingestBatchSize();
        for (let i = 0; i < threadGroups.length; i += batchSize) {
          await Promise.all(
            threadGroups.slice(i, i + batchSize).map(group => ingestThread(group)),
          );
        }

        if (!page.nextCursor) break;
        // Moving cursor first keeps both loop exits below pointing at the first
        // unfetched page, which is what the parked resume cursor must store.
        cursor = page.nextCursor;
        if (pageCount >= MAX_PAGES) {
          const msg = `hard page cap ${MAX_PAGES} hit mid-export — nothing after this page ingested`;
          logger.warn(`${TAG} ${msg}`, { sourceId: source.id, startDate: options.startDate, endDate: options.endDate });
          recordError(msg);
          capped = true;
          break;
        }
      }
    } catch (error) {
      await parkProgress();
      throw error;
    }

    // Budget exhausted mid-window → park this window's cursor so its next
    // fetch resumes instead of restarting at page one. A finished window
    // retires only its own entry.
    if (capped) {
      await parkProgress();
    } else {
      await this.clearResumeCursor(source.id, options.startDate, options.endDate);
    }

    logger.info(
      `${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${totalErrors} pages=${pageCount}${capped ? ' partial=true' : ''}`,
      { channelId, startDate: options.startDate, endDate: options.endDate },
    );
    return {
      processed,
      newTickets,
      skipped,
      errors,
      ...(capped && { partial: true }),
      ...(totalErrors > errors.length && { totalErrors }),
    };
  }

  /**
   * One signed GET against the app's export API.
   *
   * 429/503 back off in place, honoring `Retry-After`. Every other non-2xx and
   * any transport error throws — 5xx and transport are retryable by the
   * caller's job retry, other 4xx are permanent. Backoff sleeps are charged
   * against `deadline`: a wait the run budget cannot absorb raises
   * AppDeskExportThrottledError so the export stops cleanly instead of
   * sleeping through the Bull lock.
   */
  private async fetchPage(
    baseUrl: string,
    signingSecret: string,
    startDate: string,
    endDate: string,
    cursor: string | undefined,
    deadline: number,
  ): Promise<AppDeskExportPage> {
    const url = new URL(`${baseUrl}/export/messages`);
    url.searchParams.set('startDate', startDate);
    url.searchParams.set('endDate', endDate);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);
    url.searchParams.sort();
    const pathWithQuery = `${url.pathname}${url.search}`;

    for (let attempt = 0; ; attempt += 1) {
      // Re-signed every attempt: X-Xyne-Timestamp ages while we back off, and
      // the contract has apps reject signatures outside a ±5 min skew window.
      const headers = buildSignedAppRequestHeaders({
        signingSecret,
        method: 'GET',
        pathWithQuery,
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

      if (response.status === 429 || response.status === 503) {
        const waitMs =
          parseRetryAfterMs(response.headers.get('Retry-After')) ??
          THROTTLE_BACKOFF_BASE_MS * 2 ** attempt;
        const remainingMs = deadline - Date.now();
        if (attempt >= MAX_THROTTLE_RETRIES || waitMs >= remainingMs) {
          throw new AppDeskExportThrottledError(
            `${TAG} export throttled (${response.status}) after ${attempt + 1} attempt(s); ` +
              `asked to wait ${waitMs}ms with ${Math.max(0, remainingMs)}ms of run budget left`,
            waitMs,
          );
        }
        logger.warn(
          `${TAG} export throttled (${response.status}); sleeping ${waitMs}ms (attempt ${attempt + 1}/${MAX_THROTTLE_RETRIES})`,
        );
        await sleep(waitMs);
        continue;
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
  }

  /** Honor a parked cursor only when it belongs to the exact window being fetched. */
  private readResumeCursor(
    source: ExternalSource,
    startDate: string,
    endDate: string,
  ): ExportResumeCursor | null {
    const raw = source.lastSyncCursor;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ResumeCursorMap;
      const entry = parsed?.[windowKey(startDate, endDate)];
      if (!entry?.cursor) return null;
      return {
        cursor: entry.cursor,
        pageCount: entry.pageCount ?? 0,
        parkedAt: entry.parkedAt ?? 0,
      };
    } catch {
      return null;
    }
  }

  // Both writes are best-effort: losing the cursor only means the next run
  // restarts the window, and per-message dedup absorbs the overlap. The row is
  // re-read before merging so two windows parking concurrently don't clobber
  // each other.
  private async persistResumeCursor(
    sourceId: string,
    startDate: string,
    endDate: string,
    resume: ExportResumeCursor,
  ): Promise<void> {
    try {
      const map = await this.loadCursorMap(sourceId);
      map[windowKey(startDate, endDate)] = resume;
      while (Object.keys(map).length > MAX_RESUME_WINDOWS) {
        let oldestKey = '';
        let oldestParkedAt = Infinity;
        for (const [key, entry] of Object.entries(map)) {
          if (entry.parkedAt < oldestParkedAt) {
            oldestParkedAt = entry.parkedAt;
            oldestKey = key;
          }
        }
        // A malformed entry (no parkedAt) must not wedge the loop — evict
        // anything rather than spin on a delete that never matches.
        if (!oldestKey) oldestKey = Object.keys(map)[0];
        delete map[oldestKey];
      }
      await externalSourceRepo.update(sourceId, { lastSyncCursor: JSON.stringify(map) });
      logger.info(`${TAG} [CURSOR_PARKED] export budget exhausted mid-window`, {
        sourceId,
        startDate,
        endDate,
        pagesIngested: resume.pageCount,
        parkedWindows: Object.keys(map).length,
      });
    } catch (error) {
      logger.warn(`${TAG} failed to park resume cursor`, { sourceId, error });
    }
  }

  private async clearResumeCursor(sourceId: string, startDate: string, endDate: string): Promise<void> {
    try {
      const map = await this.loadCursorMap(sourceId);
      const key = windowKey(startDate, endDate);
      if (!(key in map)) return;
      delete map[key];
      await externalSourceRepo.update(sourceId, {
        lastSyncCursor: Object.keys(map).length > 0 ? JSON.stringify(map) : null,
      });
      logger.info(`${TAG} [CURSOR_CLEARED] window export completed`, { sourceId });
    } catch (error) {
      logger.warn(`${TAG} failed to clear resume cursor`, { sourceId, error });
    }
  }

  /** Current cursor map for a source row; a missing/unreadable column reads as an empty map. */
  private async loadCursorMap(sourceId: string): Promise<ResumeCursorMap> {
    const row = await db.externalSource.findUnique({
      where: { id: sourceId },
      select: { lastSyncCursor: true },
    });
    if (!row?.lastSyncCursor) return {};
    try {
      const parsed = JSON.parse(row.lastSyncCursor) as ResumeCursorMap;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Mirror of appDeskInbound's persist path for one pulled message. */
  private async ingestMessage(ctx: IngestContext, message: AppDeskExportMessage): Promise<'created' | 'appended' | 'skipped' | 'failed'> {
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
    // Guard mirrors appDeskInbound: the live shape is
    // { conversation, ... } | { isDuplicate: true }, but stay null-safe and
    // blocked-aware (cf. IngestEmailThreadResult) — a future result shape must
    // not be silently misfiled as created.
    const guardable: Awaited<ReturnType<typeof emailService.createConversationWithEmail>> | { blocked: true } | null = result;
    if (guardable && 'blocked' in guardable && guardable.blocked) return 'failed';
    if (guardable && 'isDuplicate' in guardable && guardable.isDuplicate) return 'skipped';
    if (!guardable) return 'failed';
    return 'created';
  }
}

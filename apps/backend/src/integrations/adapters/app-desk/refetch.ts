/**
 * App Desk refetch — pulls historical tickets from a Xyne App's export API into
 * its desk channel. Where that API lives and what it is sent is per-install
 * configuration (`installed_apps.fetchConfig`, see apps/core/appFetchConfig.ts);
 * this adapter owns the windowing, pagination and ingest around it.
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
import { EmailType, ExternalEntityType, isDeskChannelType } from '@xyne/shared';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { resolveAppDeskInstalledAppId, scopeExternalMessageIdToSource } from '../../core/deskSources';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { repositories } from '@/database/repositories';
import { ExternalSourceRepository, MAILBOX_SOURCE_TYPES } from '@/database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { emailService } from '@/services/emailService';
import { websocketService } from '@/services/websocketService';
import {
  AttachmentConversionService,
  ExternalAttachmentService,
  type ExternalAttachment,
} from '@/services/externalAttachmentService';
import { SsrfBlockedError, safeWebhookFetch } from '@/utils/ssrfGuard';
import type { UploadedFileResult } from '@/services/fileUploadService';
import {
  buildPartialCustomFieldWritePayload,
  CustomFieldWritePayload,
  syncCustomFieldValues,
} from '@/services/ticketCustomFieldService';
import { extractEmailAddress } from '@/utils/email';
import {
  AppFetchResponseTooLargeError,
  dispatchAppFetch,
  readCappedText,
} from '@/apps/core/appFetchDispatch';
import {
  AppFetchConfig,
  AppFetchVariables,
  buildSignedFetchRequest,
  mapExportPage,
  parseFetchConfig,
} from '@/apps/core/appFetchConfig';
import { config } from '@/config/env';
import { AppDeskExportMessage, AppDeskExportPage } from './types';
import { AppDeskExportError, AppDeskExportThrottledError } from './errors';
import { DuplicateScopeFieldValue } from '@/services/ticketDuplicateService';

const TAG = '[AppDeskRefetch]';
const MAX_PAGES = 500;
// Per-page timeout comes from the install's fetch config; this overall
// wall-clock budget is sized under the Bull lock, so a hung app can't stall the
// shared refetch processor.
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
const MAX_ATTACHMENTS_PER_MESSAGE = 20;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_TIMEOUT_MS = 30_000;
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
  /** Which pagination mode produced `cursor`. */
  mode?: 'cursor' | 'offset';
}

type ResumeCursorMap = Record<string, ExportResumeCursor>;

/** Key under which a window's cursor is parked in the cursor map. */
const windowKey = (startDate: string, endDate: string): string => `${startDate}|${endDate}`;

interface IngestContext {
  source: ExternalSource;
  channelId: string;
  recipientEmail: string;
  installedAppId: string;
  actingUser: { id: string; name?: string; email?: string };
  boardId: string;
  workspaceId: string;
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
      select: {
        fetchConfig: true,
        appId: true,
        webhookUrl: true,
        userId: true,
        app: { select: { signingSecret: true } },
      },
    });
    if (!installedApp) {
      throw new AppDeskExportError(
        `${TAG} the app backing source ${source.name} no longer exists (install ${installedAppId})`,
      );
    }
    if (!installedApp.app?.signingSecret) {
      throw new AppDeskExportError(
        `${TAG} app backing source ${source.name} has no signing secret — cannot authenticate export`,
      );
    }
    const signingSecret = decrypt(installedApp.app.signingSecret);
    // How to call the app — URL, method, headers, body template — is per-install
    // configuration, not something this adapter derives. A missing or malformed
    // config is a hard stop: there is no default endpoint to fall back to.
    let fetchConfig: AppFetchConfig;
    try {
      fetchConfig = parseFetchConfig(
        installedApp.fetchConfig,
        `app backing source ${source.name}`,
      );
    } catch (error) {
      throw new AppDeskExportError(
        `${TAG} ${error instanceof Error ? error.message : String(error)}`,
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

    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { name: true, type: true },
    });
    if (!channel || !isDeskChannelType(channel.type)) {
      throw new AppDeskExportError(
        `${TAG} channel ${channelId} is not a desk channel — refusing to ingest`,
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

    const installingUser = await repositories.users.findById(installedApp.userId);

    const ctx: IngestContext = {
      source,
      channelId,
      recipientEmail,
      installedAppId,
      actingUser: {
        id: installedApp.userId,
        ...(installingUser && { name: installingUser.name, email: installingUser.email }),
      },
      boardId: preference.boardId,
      workspaceId: source.workspaceId,
    };

    // Everything an install's body template may interpolate. `channel` (read
    // above) is what lets one app serve many desks off a single config: the app
    // branches on the id we send rather than us holding a config per channel.
    const { startDate, endDate } = options;
    const buildVars = (pageCursor: string | undefined, offset: number): AppFetchVariables => ({
      fetch: {
        startDate,
        endDate,
        cursor: pageCursor ?? '',
        offset,
        limit: fetchConfig.pageSize,
      },
      channel: { id: channelId, name: channel?.name ?? '' },
      source: { id: source.id },
      installedApp: { id: installedAppId },
      app: { id: installedApp.appId },
      workspace: { id: source.workspaceId },
    });

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
    const offsetMode = fetchConfig.pagination === 'offset';
    const resume = this.readResumeCursor(
      source,
      options.startDate,
      options.endDate,
      offsetMode ? 'offset' : 'cursor',
    );
    if (resume) {
      logger.info(`${TAG} resuming window export from parked cursor (${resume.pageCount} pages already ingested)`, {
        sourceId: source.id,
        startDate: options.startDate,
        endDate: options.endDate,
      });
    }

    // One parked value serves both modes: an opaque token in cursor mode, the
    // decimal offset in offset mode. A malformed parked offset restarts the
    // window rather than resuming somewhere arbitrary.
    let cursor: string | undefined = offsetMode ? undefined : resume?.cursor;
    let offset = offsetMode ? Number(resume?.cursor ?? 0) : 0;
    if (!Number.isInteger(offset) || offset < 0) offset = 0;
    let pageCount = 0;
    let capped = false;
    const deadline = Date.now() + EXPORT_WALL_CLOCK_MS;

    const windowStart = options.startDate;
    const windowEnd = options.endDate;
    const parkProgress = async (): Promise<void> => {
      const parkedCursor = offsetMode ? String(offset) : cursor;
      if (!parkedCursor) return;
      await this.persistResumeCursor(source.id, windowStart, windowEnd, {
        cursor: parkedCursor,
        pageCount: (resume?.pageCount ?? 0) + pageCount,
        parkedAt: Date.now(),
        mode: offsetMode ? 'offset' : 'cursor',
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
            fetchConfig,
            signingSecret,
            buildVars(cursor, offset),
            deadline,
            installedApp.webhookUrl,
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
        for (const invalid of page.invalidRows) {
          logger.warn(`${TAG} unmappable row skipped`, { sourceId: source.id, detail: invalid });
          recordError(invalid);
        }

        // Pre-dedup the page in one query, as GoogleRefetch does before it
        // fetches anything. Without it a re-run over an already-ingested window
        // costs one lookup per message across every page. The filter runs before
        // ingestThread, so a duplicate also costs no attachment download.
        let pageMessages = page.messages;
        if (pageMessages.length > 0) {
          // Both id forms are looked up. Source-scoping (#1248) is recent, so
          // anything this app pushed before it is stored under the RAW id.
          const scopedIds = pageMessages.map(m =>
            scopeExternalMessageIdToSource(source.id, m.externalId),
          );
          const rawIds = pageMessages.map(m => m.externalId);
          const existingRows = await externalMessageRepo.findByExternalIds(source.id, [
            ...scopedIds,
            ...rawIds,
          ]);
          if (existingRows.length > 0) {
            const existing = new Set(existingRows.map(r => r.externalId));
            const remaining = pageMessages.filter(
              m =>
                !existing.has(scopeExternalMessageIdToSource(source.id, m.externalId)) &&
                !existing.has(m.externalId),
            );
            skipped += pageMessages.length - remaining.length;
            logger.info(`${TAG} pre-dedup: skipped ${pageMessages.length - remaining.length} already-ingested messages`, {
              sourceId: source.id,
              remaining: remaining.length,
            });
            pageMessages = remaining;
          }
        }

        const threadGroups = groupPageByThread(pageMessages);
        const batchSize = ingestBatchSize();
        for (let i = 0; i < threadGroups.length; i += batchSize) {
          await Promise.all(
            threadGroups.slice(i, i + batchSize).map(group => ingestThread(group)),
          );
        }

        if (offsetMode) {
          // No continuation token exists in this mode: an empty page is the
          // only end-of-data signal, so it must be checked before advancing.
          if (page.messages.length === 0 && page.invalidRows.length === 0) break;
          offset += fetchConfig.pageSize;
        } else {
          if (!page.nextCursor) break;
          if (page.nextCursor === cursor) {
            const msg =
              `app returned the same cursor twice ("${page.nextCursor}") — stopping to avoid an endless loop. ` +
              'Check that the request actually sends {{fetch.cursor}}.';
            logger.warn(`${TAG} ${msg}`, { sourceId: source.id, channelId });
            recordError(msg);
            capped = true;
            break;
          }
          // Moving cursor first keeps both loop exits below pointing at the
          // first unfetched page, which is what the parked cursor must store.
          cursor = page.nextCursor;
        }
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
    } finally {
      await this.flushChannelSideEffects(channelId, newTickets, processed);
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
   * Replay, once, the channel-scoped work the per-message persist calls were
   * told to skip.
   *
   * Only new tickets count toward the unread bump: an appended message bumps
   * just the users who were already caught up, and that narrow write still
   * happens inline (emailService keeps it, exactly as ingestEmailThread keeps
   * its own wasVespaMerge case).
   *
   * Best-effort — a badge that is briefly stale must not fail a run whose rows
   * are already committed, so each write is caught and logged.
   */
  private async flushChannelSideEffects(
    channelId: string,
    newTickets: number,
    processed: number,
  ): Promise<void> {
    if (newTickets > 0) {
      try {
        await repositories.channels.incrementUnreadForAllMembers(channelId, newTickets);
      } catch (error) {
        logger.warn(`${TAG} end-of-run unread bump failed`, { channelId, newTickets, error });
      }
    }
    if (processed > 0) {
      try {
        await repositories.channels.updateLastActivity(channelId);
      } catch (error) {
        logger.warn(`${TAG} end-of-run updateLastActivity failed`, { channelId, error });
      }
      try {
        websocketService.broadcastLabelUnreadCountsUpdate(channelId);
      } catch (error) {
        logger.warn(`${TAG} end-of-run label unread broadcast failed`, { channelId, error });
      }
    }
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
    fetchConfig: AppFetchConfig,
    signingSecret: string,
    vars: AppFetchVariables,
    deadline: number,
    ownWebhookUrl: string | null,
  ): Promise<AppDeskExportPage> {
    for (let attempt = 0; ; attempt += 1) {
      // Rebuilt every attempt rather than hoisted: X-Xyne-Timestamp ages while
      // we back off, and the contract has apps reject signatures outside a
      // ±5 min skew window. The body is re-rendered with it so it stays the
      // body the fresh signature covers.
      const request = buildSignedFetchRequest({ config: fetchConfig, vars, signingSecret });

      let response: Response;
      try {
        // Clamped to what is left of the run budget: timeoutMs may be up to
        // 10 minutes, which on a late page would outlive the Bull lock. The job
        // would then be marked stalled and re-run while this one is still
        // ingesting, giving two concurrent exports over the same window.
        const remainingMs = deadline - Date.now();
        response = await dispatchAppFetch(
          request,
          Math.max(1_000, Math.min(fetchConfig.timeoutMs, remainingMs)),
          { ownWebhookUrl },
        );
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
        const detail = (await readCappedText(response).catch(() => '')).slice(0, 200);
        throw new AppDeskExportError(
          `${TAG} export returned ${response.status}${detail ? `: ${detail}` : ''}`,
          response.status,
        );
      }

      let raw: unknown;
      try {
        // Size-capped rather than response.json(): an unbounded body would be
        // buffered whole into the shared worker before anything validated it.
        raw = JSON.parse(await readCappedText(response));
      } catch (error) {
        if (error instanceof AppFetchResponseTooLargeError) {
          throw new AppDeskExportError(`${TAG} ${error.message}`);
        }
        throw new AppDeskExportError(`${TAG} export response was not valid JSON`);
      }
      // The app's own shape is translated here rather than being required to
      // match ours — see AppFetchResponseMappingSchema. A mapping that points at
      // a field the app does not send fails with that path named.
      try {
        return mapExportPage(raw, fetchConfig.response, fetchConfig.pagination);
      } catch (error) {
        throw new AppDeskExportError(
          `${TAG} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Honor a parked cursor only when it belongs to the exact window being fetched. */
  private readResumeCursor(
    source: ExternalSource,
    startDate: string,
    endDate: string,
    expectedMode: 'cursor' | 'offset',
  ): ExportResumeCursor | null {
    const raw = source.lastSyncCursor;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ResumeCursorMap;
      const entry = parsed?.[windowKey(startDate, endDate)];
      if (!entry?.cursor) return null;
      if (entry.mode !== expectedMode) {
        logger.info(`${TAG} discarding a resume cursor parked under a different pagination mode`, {
          sourceId: source.id,
          parkedMode: entry.mode ?? 'unknown',
          expectedMode,
        });
        return null;
      }
      return {
        cursor: entry.cursor,
        pageCount: entry.pageCount ?? 0,
        parkedAt: entry.parkedAt ?? 0,
        mode: entry.mode,
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

    const senderEmail = message.sender?.email?.trim() || undefined;
    const senderName = message.sender?.name?.trim() || undefined;
    let emailFrom =
      (senderName && senderEmail && `${senderName} <${senderEmail}>`) ||
      senderName ||
      senderEmail ||
      '';
    if (!emailFrom) {
      emailFrom = ctx.actingUser.email
        ? `${ctx.actingUser.name} <${ctx.actingUser.email}>`
        : ctx.actingUser.name ?? 'External user';
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

    const uploadedFiles = await this.downloadAttachments(ctx, message);

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
        deferChannelSideEffects: true,
        ...(uploadedFiles.length > 0 && { uploadedFiles }),
      });
      await this.applyFormFieldsToThread(ctx, message, threadEmail.conversationId);
      return 'appended';
    }

    const { customFieldValues, scopeFieldValues, validationErrors } =
      await this.buildFormFieldWrite(ctx.boardId, ctx, message, {
        requireAllRequiredFields: true,
      });

    const result = await emailService.createConversationWithEmail({
      channelId,
      userId: ctx.actingUser.id,
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
          ...(extractEmailAddress(senderEmail) && {
            reporterEmail: extractEmailAddress(senderEmail)!,
          }),
          fromEmailAddress: senderEmail,
        }),
      },
      receivedAt,
      boardId: ctx.boardId,
      deferChannelSideEffects: true,
      ...(uploadedFiles.length > 0 && { uploadedFiles }),
      ...(scopeFieldValues && { scopeFieldValues }),
    });
    // Guard mirrors appDeskInbound: the live shape is
    // { conversation, ... } | { isDuplicate: true }, but stay null-safe and
    // blocked-aware (cf. IngestEmailThreadResult) — a future result shape must
    // not be silently misfiled as created.
    const guardable: Awaited<ReturnType<typeof emailService.createConversationWithEmail>> | { blocked: true } | null = result;
    if (guardable && 'blocked' in guardable && guardable.blocked) return 'failed';
    if (guardable && 'isDuplicate' in guardable && guardable.isDuplicate) return 'skipped';
    if (!guardable) return 'failed';

    this.logFormFieldIssues(message, validationErrors);
    const { ticket } = guardable as { ticket?: { id?: string } };
    if (customFieldValues && customFieldValues.fieldValues.length > 0 && ticket?.id) {
      await syncCustomFieldValues(ticket.id, customFieldValues, ctx.actingUser.id);
    }
    return 'created';
  }

  /**
   * Fetch the message's attachments into storage, in the shape
   * createConversationWithEmail already takes from the push path's multipart
   * upload. The export is JSON and cannot carry file parts, so an app sends URLs
   * and this reuses the same downloader Slack and Zoho go through.
   *
   * Never throws: an attachment that cannot be fetched must not cost us the
   * message it belongs to, nor the rest of the page.
   */
  private async downloadAttachments(
    ctx: IngestContext,
    message: AppDeskExportMessage,
  ): Promise<UploadedFileResult[]> {
    if (!message.attachments || message.attachments.length === 0) return [];
    // Capped because the count is app-controlled and unrelated to the 32MB page
    // limit: a page well inside that limit can declare thousands of URLs, and
    // each one is buffered whole.
    const attachments = message.attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    if (message.attachments.length > attachments.length) {
      logger.warn(`${TAG} message declares more attachments than the per-message cap — ignoring the rest`, {
        externalId: message.externalId,
        declared: message.attachments.length,
        cap: MAX_ATTACHMENTS_PER_MESSAGE,
      });
    }
    try {
      const fetched: ExternalAttachment[] = [];
      for (const a of attachments) {
        const bytes = await this.fetchAttachmentBytes(ctx, message, a);
        if (bytes) {
          fetched.push({
            fileName: a.fileName,
            buffer: bytes.buffer,
            fileUrl: a.fileUrl,
            mimeType: bytes.contentType ?? a.mimeType,
            size: bytes.buffer.length,
          });
        }
      }
      if (fetched.length === 0) return [];
      const downloaded = await new ExternalAttachmentService().downloadAttachmentsForSource(
        ctx.source.name,
        fetched,
        { scopeType: 'EXTERNAL_MESSAGE', scopeId: ctx.source.id },
      );
      return AttachmentConversionService.convertDownloadedToUploaded(downloaded);
    } catch (error) {
      logger.warn(`${TAG} could not download attachments — ingesting the message without them`, {
        externalId: message.externalId,
        externalSourceId: ctx.source.id,
        attachmentCount: attachments.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * One attachment's bytes and served content type, or null if it must not or
   * cannot be fetched.
   *
   * `safeWebhookFetch` is the same guard `dispatchAppFetch` applies to the export
   * URL: it DNS-pins against private, loopback, link-local and cloud-metadata
   * addresses so a second DNS answer cannot swing the connection after the check.
   * `redirect: 'manual'` is mandatory with it — a 3xx target is a fresh URL it has
   * not validated, and following one would reopen the hole on a host that passed.
   */
  private async fetchAttachmentBytes(
    ctx: IngestContext,
    message: AppDeskExportMessage,
    attachment: { fileName: string; fileUrl: string },
  ): Promise<{ buffer: Buffer; contentType?: string } | null> {
    const drop = (reason: string): null => {
      logger.warn(`${TAG} attachment skipped`, {
        externalId: message.externalId,
        externalSourceId: ctx.source.id,
        fileName: attachment.fileName,
        reason,
      });
      return null;
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ATTACHMENT_TIMEOUT_MS);
    try {
      const response = await safeWebhookFetch(attachment.fileUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        return drop(`redirected (${response.status}) — the target is an unvalidated URL`);
      }
      if (!response.ok) return drop(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
        return drop(`declares ${declared} bytes (max ${MAX_ATTACHMENT_BYTES})`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      // Re-checked against the body: content-length is the app's claim, not a fact.
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        return drop(`${buffer.length} bytes exceeds the ${MAX_ATTACHMENT_BYTES} limit`);
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || undefined;
      return { buffer, contentType };
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        return drop(`blocked destination — ${error.message}`);
      }
      return drop(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async buildFormFieldWrite(
    boardId: string,
    ctx: IngestContext,
    message: AppDeskExportMessage,
    options: { requireAllRequiredFields: boolean },
  ): Promise<{
    customFieldValues?: CustomFieldWritePayload;
    scopeFieldValues?: DuplicateScopeFieldValue[];
    validationErrors: Array<{ error: string; code: 'VALIDATION_ERROR' }>;
  }> {
    if (!message.additionalFormFields) return { validationErrors: [] };
    const { customFieldValues, validationErrors } = await buildPartialCustomFieldWritePayload(
      boardId,
      ctx.workspaceId,
      message.additionalFormFields,
      options,
    );
    const scopeFieldValues =
      customFieldValues && customFieldValues.fieldValues.length > 0
        ? customFieldValues.fieldValues.map(fv => ({
            fieldId: fv.fieldId,
            value: fv.actualFieldValue,
          }))
        : undefined;
    return { customFieldValues, scopeFieldValues, validationErrors };
  }

  /**
   * Append branch — mirrors appDeskInbound's: the fields belong to the ticket
   * that already owns the thread, so they are written against *its* board rather
   * than the channel's, which may since have changed.
   */
  private async applyFormFieldsToThread(
    ctx: IngestContext,
    message: AppDeskExportMessage,
    conversationId: string,
  ): Promise<void> {
    if (!message.additionalFormFields) return;
    const ticket = await db.ticket.findFirst({
      where: { conversationId },
      select: { id: true, boardId: true },
    });
    if (!ticket?.id) return;
    if (!ticket.boardId) {
      logger.warn(`${TAG} ticket has no board — skipping form fields for appended message`, {
        ticketId: ticket.id,
        externalId: message.externalId,
      });
      return;
    }
    const { customFieldValues, validationErrors } = await this.buildFormFieldWrite(
      ticket.boardId,
      ctx,
      message,
      { requireAllRequiredFields: false },
    );
    this.logFormFieldIssues(message, validationErrors);
    if (customFieldValues && customFieldValues.fieldValues.length > 0) {
      await syncCustomFieldValues(ticket.id, customFieldValues, ctx.actingUser.id);
    }
  }

  /**
   * Per-field problems are reported, not thrown: the app's form and the board's
   * can drift, and one unmapped key should leave the rest of the ticket intact.
   */
  private logFormFieldIssues(
    message: AppDeskExportMessage,
    validationErrors: Array<{ error: string; code: 'VALIDATION_ERROR' }>,
  ): void {
    if (validationErrors.length === 0) return;
    logger.warn(`${TAG} form field values were rejected for a pulled message`, {
      externalId: message.externalId,
      errors: validationErrors.map(e => e.error),
    });
  }
}

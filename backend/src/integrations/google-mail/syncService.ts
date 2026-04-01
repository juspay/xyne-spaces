import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { externalSourceCore } from '@/integrations/core/core';
import { googleMailAdapter } from '@/integrations/adapters/google-mail';
import { googleMailVespaService } from './vespaMailService';
import { logger } from '@/utils/logger';
import {
  getAuthorizedGoogleMailClient,
  parseGoogleMailSourceCredentials,
  saveGoogleMailSourceCredentials,
} from './credentials';
import type { GoogleMailSourceCredentials, GoogleMailSyncMode, GoogleMailSyncResult } from './types';

const FULL_SYNC_PAGE_SIZE = 50;
const HISTORY_SYNC_PAGE_SIZE = 100;
const THREAD_BATCH_SIZE = 10;
const FULL_SYNC_LOOKBACK_MONTHS = 6;
export const FULL_SYNC_MAX_MESSAGES = 10000;
const SKIPPED_LABELS = new Set(['SPAM', 'TRASH', 'CATEGORY_PROMOTIONS', 'DRAFT']);

interface MessageProcessingOptions {
  cutoffTimestamp?: number;
  fullSyncProgress?: FullSyncProgress;
}

interface FullSyncProgress {
  cutoffTimestamp: number;
  processedMessages: number;
  limitReached: boolean;
  totalMessages: number;
  onProgress?: (processedMessages: number, totalMessages: number) => Promise<void>;
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
};

const getMessageTimestamp = (message: gmail_v1.Schema$Message): number => {
  return parseInt(message.internalDate || '0', 10) || 0;
};

const shouldSkipMessage = (message: gmail_v1.Schema$Message): boolean => {
  const labels = message.labelIds || [];
  return labels.some(label => SKIPPED_LABELS.has(label));
};

const subtractMonths = (date: Date, months: number): Date => {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() - months);
  return nextDate;
};

const formatGmailAfterDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const isInvalidHistoryIdError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: number; response?: { status?: number }; message?: string };
  return (
    maybeError.code === 404 ||
    maybeError.response?.status === 404 ||
    maybeError.message?.toLowerCase().includes('history') === true
  );
};

class GoogleMailSyncService {
  private externalSourceRepo = new ExternalSourceRepository();

  async syncSource(sourceId: string, requestedMode: GoogleMailSyncMode): Promise<void> {
    const source = await this.externalSourceRepo.findById(sourceId);
    if (!source) {
      throw new Error(`Google Mail source ${sourceId} not found`);
    }

    if (source.sourceType !== 'google') {
      throw new Error(`External source ${sourceId} is not a Google Mail source`);
    }

    const currentStoredCredentials = parseGoogleMailSourceCredentials(source.credentials);
    if (!currentStoredCredentials.tokens?.refreshToken) {
      throw new Error(`Google Mail source ${sourceId} is not authenticated`);
    }

    await this.persistState(sourceId, {
      ...currentStoredCredentials,
      mailbox: {
        ...(currentStoredCredentials.mailbox || {}),
        syncProcessedMessages: requestedMode === 'full' ? 0 : null,
        syncTotalMessages: requestedMode === 'full' ? FULL_SYNC_MAX_MESSAGES : null,
        syncStartedAt: requestedMode === 'full' ? new Date().toISOString() : null,
        syncMode: requestedMode,
      },
      status: 'syncing',
      lastError: null,
    });

    try {
      const { oauthClient, storedCredentials } = await getAuthorizedGoogleMailClient(source);
      const gmail = google.gmail({ version: 'v1', auth: oauthClient as any });
      const effectiveMode =
        requestedMode === 'incremental' && storedCredentials.mailbox?.historyId
          ? 'incremental'
          : 'full';

      const result =
        effectiveMode === 'full'
          ? await this.runFullSync(gmail, source, storedCredentials)
          : await this.runIncrementalSync(gmail, source, storedCredentials);

      const latestSource = await this.externalSourceRepo.findById(sourceId);
      const latestStoredCredentials = latestSource
        ? parseGoogleMailSourceCredentials(latestSource.credentials)
        : storedCredentials;
      const preservedMailboxState =
        effectiveMode === 'full'
          ? {
              syncProcessedMessages:
                latestStoredCredentials.mailbox?.syncProcessedMessages ?? FULL_SYNC_MAX_MESSAGES,
              syncTotalMessages:
                latestStoredCredentials.mailbox?.syncTotalMessages ?? FULL_SYNC_MAX_MESSAGES,
              syncStartedAt: latestStoredCredentials.mailbox?.syncStartedAt ?? new Date().toISOString(),
            }
          : {
              syncProcessedMessages: null,
              syncTotalMessages: null,
              syncStartedAt: null,
            };

      await this.persistState(sourceId, {
        ...latestStoredCredentials,
        mailbox: {
          ...(latestStoredCredentials.mailbox || {}),
          emailAddress: result.mailboxEmail,
          historyId: result.historyId,
          lastSyncedAt: new Date().toISOString(),
          ...preservedMailboxState,
          syncMode: null,
        },
        status: 'connected',
        lastError: null,
      });
    } catch (error) {
      const latestSource = await this.externalSourceRepo.findById(sourceId);
      const latestStoredCredentials = latestSource
        ? parseGoogleMailSourceCredentials(latestSource.credentials)
        : currentStoredCredentials;

      await this.persistState(sourceId, {
        ...latestStoredCredentials,
        mailbox: {
          ...(latestStoredCredentials.mailbox || {}),
          syncProcessedMessages: null,
          syncTotalMessages: null,
          syncStartedAt: null,
          syncMode: null,
        },
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  async syncAuthenticatedSources(): Promise<void> {
    const sources = await this.externalSourceRepo.findAll({
      sourceType: 'google',
      isActive: true,
    });

    for (const source of sources) {
      try {
        const storedCredentials = parseGoogleMailSourceCredentials(source.credentials);
        if (
          !storedCredentials.tokens?.refreshToken ||
          storedCredentials.status === 'pending_auth' ||
          storedCredentials.status === 'syncing'
        ) {
          continue;
        }

        await this.syncSource(source.id, 'incremental');
      } catch (error) {
        logger.error('[GOOGLE_MAIL] Incremental sync failed for source', {
          sourceId: source.id,
          sourceName: source.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async runFullSync(
    gmail: gmail_v1.Gmail,
    source: NonNullable<Awaited<ReturnType<ExternalSourceRepository['findById']>>>,
    storedCredentials: GoogleMailSourceCredentials
  ): Promise<GoogleMailSyncResult> {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const mailboxEmail =
      profile.data.emailAddress || storedCredentials.mailbox?.emailAddress || 'unknown@googlemail';
    const historyId = profile.data.historyId || storedCredentials.mailbox?.historyId || '';

    let nextPageToken: string | undefined;
    const cutoffDate = subtractMonths(new Date(), FULL_SYNC_LOOKBACK_MONTHS);
    const cutoffTimestamp = cutoffDate.getTime();
    const fullSyncProgress: FullSyncProgress = {
      cutoffTimestamp,
      processedMessages: 0,
      limitReached: false,
      totalMessages: FULL_SYNC_MAX_MESSAGES,
      onProgress: async (processedMessages, totalMessages) => {
        await this.persistState(source.id, {
          ...storedCredentials,
          mailbox: {
            ...(storedCredentials.mailbox || {}),
            emailAddress: mailboxEmail,
            historyId: storedCredentials.mailbox?.historyId ?? null,
            lastSyncedAt: storedCredentials.mailbox?.lastSyncedAt ?? null,
            syncProcessedMessages: processedMessages,
            syncTotalMessages: totalMessages,
            syncStartedAt: storedCredentials.mailbox?.syncStartedAt ?? new Date().toISOString(),
            syncMode: 'full',
          },
          status: 'syncing',
          lastError: null,
        });
      },
    };

    await fullSyncProgress.onProgress?.(0, FULL_SYNC_MAX_MESSAGES);

    do {
      const response = await gmail.users.threads.list({
        userId: 'me',
        includeSpamTrash: false,
        maxResults: FULL_SYNC_PAGE_SIZE,
        pageToken: nextPageToken,
        q: `-in:promotions after:${formatGmailAfterDate(cutoffDate)}`,
      });

      const threadIds = (response.data.threads || [])
        .map(thread => thread.id)
        .filter((threadId): threadId is string => Boolean(threadId));

      await this.processThreadIdsForFullSync(
        gmail,
        source,
        threadIds,
        mailboxEmail,
        fullSyncProgress
      );
      nextPageToken = response.data.nextPageToken || undefined;
    } while (nextPageToken && !fullSyncProgress.limitReached);

    logger.info('[GOOGLE_MAIL] Full sync completed', {
      sourceId: source.id,
      sourceName: source.name,
      mailboxEmail,
      processedMessages: fullSyncProgress.processedMessages,
      lookbackMonths: FULL_SYNC_LOOKBACK_MONTHS,
      maxMessages: FULL_SYNC_MAX_MESSAGES,
      limitReached: fullSyncProgress.limitReached,
    });

    return {
      mailboxEmail,
      historyId,
    };
  }

  private async runIncrementalSync(
    gmail: gmail_v1.Gmail,
    source: NonNullable<Awaited<ReturnType<ExternalSourceRepository['findById']>>>,
    storedCredentials: GoogleMailSourceCredentials
  ): Promise<GoogleMailSyncResult> {
    const historyId = storedCredentials.mailbox?.historyId;
    if (!historyId) {
      return this.runFullSync(gmail, source, storedCredentials);
    }

    try {
      const threadIds = new Set<string>();
      let nextPageToken: string | undefined;
      let nextHistoryId = historyId;

      do {
        const response = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: historyId,
          maxResults: HISTORY_SYNC_PAGE_SIZE,
          pageToken: nextPageToken,
        });

        nextHistoryId = response.data.historyId || nextHistoryId;

        await googleMailVespaService.applyHistoryChanges(
          response.data.history || [],
          storedCredentials.mailbox?.emailAddress || 'unknown@googlemail'
        );

        for (const historyRecord of response.data.history || []) {
          for (const messageAdded of historyRecord.messagesAdded || []) {
            const threadId = messageAdded.message?.threadId;
            if (threadId) {
              threadIds.add(threadId);
            }
          }
        }

        nextPageToken = response.data.nextPageToken || undefined;
      } while (nextPageToken);

      await this.processThreadIds(
        gmail,
        source,
        Array.from(threadIds),
        storedCredentials.mailbox?.emailAddress || 'unknown@googlemail',
        {
          cutoffTimestamp: subtractMonths(new Date(), FULL_SYNC_LOOKBACK_MONTHS).getTime(),
        }
      );

      return {
        mailboxEmail: storedCredentials.mailbox?.emailAddress || 'unknown@googlemail',
        historyId: nextHistoryId,
      };
    } catch (error) {
      if (isInvalidHistoryIdError(error)) {
        logger.warn('[GOOGLE_MAIL] Falling back to full sync after invalid historyId', {
          sourceId: source.id,
          sourceName: source.name,
        });
        return this.runFullSync(gmail, source, storedCredentials);
      }

      throw error;
    }
  }

  private async processThreadIds(
    gmail: gmail_v1.Gmail,
    source: NonNullable<Awaited<ReturnType<ExternalSourceRepository['findById']>>>,
    threadIds: string[],
    mailboxEmail: string,
    options?: MessageProcessingOptions
  ): Promise<void> {
    for (const batch of chunk(threadIds, THREAD_BATCH_SIZE)) {
      await Promise.allSettled(
        batch.map(threadId =>
          this.processSingleThread(gmail, source, threadId, mailboxEmail, options)
        )
      );
    }
  }

  private async processThreadIdsForFullSync(
    gmail: gmail_v1.Gmail,
    source: NonNullable<Awaited<ReturnType<ExternalSourceRepository['findById']>>>,
    threadIds: string[],
    mailboxEmail: string,
    fullSyncProgress: FullSyncProgress
  ): Promise<void> {
    for (const threadId of threadIds) {
      if (fullSyncProgress.limitReached) {
        return;
      }

      await this.processSingleThread(gmail, source, threadId, mailboxEmail, {
        cutoffTimestamp: fullSyncProgress.cutoffTimestamp,
        fullSyncProgress,
      });
    }
  }

  private async processSingleThread(
    gmail: gmail_v1.Gmail,
    source: NonNullable<Awaited<ReturnType<ExternalSourceRepository['findById']>>>,
    threadId: string,
    mailboxEmail: string,
    options?: MessageProcessingOptions
  ): Promise<void> {
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const messages = [...(response.data.messages || [])]
      .filter(message => message.id && message.threadId)
      .sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));

    for (const message of messages) {
      if (options?.fullSyncProgress?.limitReached) {
        return;
      }

      if (shouldSkipMessage(message)) {
        continue;
      }

      const messageTimestamp = getMessageTimestamp(message);
      if (options?.cutoffTimestamp && messageTimestamp < options.cutoffTimestamp) {
        continue;
      }

      if (
        options?.fullSyncProgress &&
        options.fullSyncProgress.processedMessages >= FULL_SYNC_MAX_MESSAGES
      ) {
        options.fullSyncProgress.limitReached = true;
        return;
      }

      try {
        if (source.channelId) {
          await externalSourceCore.ingest(
            googleMailAdapter,
            source.name,
            {
              message,
              mailboxEmail,
              gmail,
            },
            source
          );
        }
      } catch (error) {
        logger.error('[GOOGLE_MAIL] Failed to ingest Gmail message', {
          sourceId: source.id,
          sourceName: source.name,
          threadId,
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      try {
        await googleMailVespaService.ingestMessage(gmail, message, mailboxEmail);
      } catch (error) {
        logger.error('[GOOGLE_MAIL] Failed to index Gmail message into Vespa', {
          sourceId: source.id,
          sourceName: source.name,
          threadId,
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      if (options?.fullSyncProgress) {
        options.fullSyncProgress.processedMessages += 1;
        await options.fullSyncProgress.onProgress?.(
          options.fullSyncProgress.processedMessages,
          options.fullSyncProgress.totalMessages
        );
        if (options.fullSyncProgress.processedMessages >= FULL_SYNC_MAX_MESSAGES) {
          options.fullSyncProgress.limitReached = true;
        }
      }
    }
  }

  private async persistState(
    sourceId: string,
    storedCredentials: GoogleMailSourceCredentials
  ): Promise<void> {
    await saveGoogleMailSourceCredentials(sourceId, storedCredentials);
  }
}

export const googleMailSyncService = new GoogleMailSyncService();

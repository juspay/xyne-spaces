import Bull from 'bull';
import { BookmarkEntityType, NotificationType, Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

type ReminderStatus = 'PENDING' | 'SENT' | 'DISMISSED';

interface ReminderNotificationContext {
  messagePreview?: string | undefined;
  conversationId?: string | undefined;
  initialMessageId?: string | undefined;
  channelId?: string | undefined;
  channelName?: string | undefined;
  channelScopeType?: string | undefined;
  senderName?: string | undefined;
}

interface ReminderMetadata {
  enabled: boolean;
  remindAt: string;
  status?: ReminderStatus | undefined;
  context?: ReminderNotificationContext | undefined;
}

interface BookmarkMetadata {
  reminder?: ReminderMetadata | null;
  snoozeUntil?: unknown;
  [key: string]: unknown;
}

interface BookmarkReminderJobData {
  userId: string;
  entityId: string;
  entityType: BookmarkEntityType;
  remindAt: string;
  workspaceId: string;
}

interface SyncBookmarkReminderParams {
  userId: string;
  entityId: string;
  entityType: BookmarkEntityType;
  metadata: unknown;
  workspaceId: string;
}

class BookmarkReminderService {
  private queue: Bull.Queue<BookmarkReminderJobData>;
  private isInitialized = false;

  constructor() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
      ...(process.env.REDIS_TLS === 'true' && {
        tls: {
          rejectUnauthorized: false,
        },
      }),
    };

    this.queue = new Bull('bookmark-reminders', { redis: redisConfig });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.queue.process('bookmark-reminder', async job => {
      await this.processReminderJob(job);
    });

    this.queue.on('failed', (job, err) => {
      logger.error('[BOOKMARK-REMINDER] Job failed', {
        jobId: job.id,
        data: job.data,
        error: err.message,
      });
    });

    this.queue.on('error', err => {
      logger.error('[BOOKMARK-REMINDER] Queue error', err);
    });

    this.isInitialized = true;
    logger.info('[BOOKMARK-REMINDER] Service initialized');
  }

  async shutdown(): Promise<void> {
    try {
      await this.queue.close();
      this.isInitialized = false;
      logger.info('[BOOKMARK-REMINDER] Service shutdown complete');
    } catch (error) {
      logger.error('[BOOKMARK-REMINDER] Shutdown failed', error);
    }
  }

  async syncBookmarkReminder(params: SyncBookmarkReminderParams): Promise<void> {
    if (!this.isInitialized) {
      logger.warn('[BOOKMARK-REMINDER] sync skipped: service not initialized', {
        entityId: params.entityId,
        entityType: params.entityType,
      });
      return;
    }

    const jobId = this.getJobId(params.userId, params.entityType, params.entityId);
    await this.removeJob(jobId);

    const activeReminder = this.getActiveReminderFromMetadata(params.metadata);
    if (!activeReminder || !this.isReminderSchedulable(activeReminder)) {
      return;
    }

    const remindAtTs = new Date(activeReminder.remindAt).getTime();
    if (!Number.isFinite(remindAtTs)) {
      return;
    }

    const delay = Math.max(0, remindAtTs - Date.now());
    await this.queue.add(
      'bookmark-reminder',
      {
        userId: params.userId,
        entityId: params.entityId,
        entityType: params.entityType,
        remindAt: activeReminder.remindAt,
        workspaceId: params.workspaceId,
      },
      {
        delay,
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    );
  }

  async cancelBookmarkReminder(params: {
    userId: string;
    entityId: string;
    entityType: BookmarkEntityType;
  }): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const jobId = this.getJobId(params.userId, params.entityType, params.entityId);
    await this.removeJob(jobId);
  }

  private async processReminderJob(job: Bull.Job<BookmarkReminderJobData>): Promise<void> {
    const { userId, entityId, entityType, remindAt, workspaceId } = job.data;

    const bookmark = await db.bookmark.findUnique({
      where: {
        userId_entityId_entityType: {
          userId,
          entityId,
          entityType,
        },
      },
      select: {
        id: true,
        userId: true,
        entityId: true,
        entityType: true,
        isDeleted: true,
        metadata: true,
      },
    });

    if (!bookmark || bookmark.isDeleted) {
      return;
    }

    const activeReminder = this.getActiveReminderFromMetadata(bookmark.metadata);
    if (!activeReminder || !this.isReminderSchedulable(activeReminder)) {
      return;
    }

    if (activeReminder.remindAt !== remindAt) {
      return;
    }

    const { title, message, actionUrl, metadata } = this.buildNotificationPayload({
      entityId,
      reminder: activeReminder,
      workspaceId,
    });

    await notificationService.createNotification(
      bookmark.userId,
      {
        type: NotificationType.CALL_UPDATED,
        title,
        message,
        relatedEntityType: 'bookmark',
        relatedEntityId: bookmark.entityId,
        actionUrl,
        metadata,
      },
      { sendDesktop: true, sendMobile: true },
    );

    try {
      await this.markReminderAsSent(bookmark.id, bookmark.metadata);
    } catch (error) {
      logger.error('[BOOKMARK-REMINDER] Failed to mark reminder as SENT', {
        bookmarkId: bookmark.id,
        entityId,
        entityType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async markReminderAsSent(bookmarkId: string, metadata: Prisma.JsonValue | null): Promise<void> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return;
    }

    const nextMetadata = { ...(metadata as BookmarkMetadata) };
    const reminder = nextMetadata.reminder;

    if (!reminder || typeof reminder !== 'object') {
      return;
    }

    nextMetadata.reminder = {
      ...reminder,
      status: 'SENT',
    };

    delete nextMetadata.snoozeUntil;

    await db.bookmark.update({
      where: { id: bookmarkId },
      data: {
        metadata: nextMetadata as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  }

  private buildNotificationPayload({
    entityId,
    reminder,
    workspaceId,
  }: {
    entityId: string;
    reminder: ReminderMetadata;
    workspaceId: string;
  }): {
    title: string;
    message: string;
    actionUrl: string;
    metadata: Record<string, unknown>;
  } {
    const reminderContext = reminder.context;
    const senderName = reminderContext?.senderName || 'Unknown User';
    const channelName = reminderContext?.channelName || 'Unknown Channel';
    const channelScopeType = reminderContext?.channelScopeType;
    const channelId = reminderContext?.channelId;
    const conversationId = reminderContext?.conversationId;
    const initialMessageId = reminderContext?.initialMessageId;
    const isDirectMessageScope = channelScopeType === 'DM' || channelScopeType === 'GROUP_DM';

    const title = reminderContext?.messagePreview?.trim()
      ? `Reminder: ${reminderContext.messagePreview.trim()}`
      : 'Reminder: Bookmarked Message';

    const hasContext = Boolean(channelId && conversationId);
    const message = hasContext
      ? isDirectMessageScope
        ? `From ${senderName} in Direct Message`
        : `From ${senderName} in #${channelName}`
      : 'From your bookmarks';

    const actionUrl = this.buildReminderActionUrl({
      entityId,
      channelId,
      conversationId,
      initialMessageId,
      workspaceId,
    });

    return {
      title,
      message,
      actionUrl,
      metadata: {
        messageId: entityId,
        ...(conversationId && { conversationId }),
        ...(channelId && { channelId }),
        ...(initialMessageId && { initialMessageId }),
        ...(reminderContext?.senderName && { senderName: reminderContext.senderName }),
        ...(reminderContext?.channelName && { channelTitle: reminderContext.channelName }),
        ...(channelScopeType && {
          messageType: isDirectMessageScope ? 'dm' : 'channel',
        }),
      },
    };
  }

  private buildReminderActionUrl({
    entityId,
    channelId,
    conversationId,
    initialMessageId,
    workspaceId,
  }: {
    entityId: string;
    channelId?: string | undefined;
    conversationId?: string | undefined;
    initialMessageId?: string | undefined;
    workspaceId: string;
  }): string {
    const basePath = `/${workspaceId}/chat/bookmarks`;
    if (!channelId || !conversationId) {
      return basePath;
    }

    const isThreadReply = Boolean(initialMessageId && initialMessageId !== entityId);
    if (isThreadReply) {
      return `${basePath}/${channelId}/${conversationId}#origin=${conversationId}&messageId=${entityId}`;
    }
    return `${basePath}/${channelId}#origin=${conversationId}&messageId=${entityId}`;
  }

  private getActiveReminderFromMetadata(metadata: unknown): ReminderMetadata | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const bookmarkMetadata = metadata as BookmarkMetadata;
    const reminderData = bookmarkMetadata.reminder;

    if (reminderData && reminderData.enabled === true && typeof reminderData.remindAt === 'string') {
      return reminderData;
    }

    if (typeof bookmarkMetadata.snoozeUntil === 'string' && bookmarkMetadata.snoozeUntil.length > 0) {
      return {
        enabled: true,
        remindAt: bookmarkMetadata.snoozeUntil,
        status: 'PENDING',
      };
    }

    return null;
  }

  private isReminderSchedulable(reminder: ReminderMetadata): boolean {
    if (!reminder.enabled || !reminder.remindAt) {
      return false;
    }
    if (reminder.status === 'SENT' || reminder.status === 'DISMISSED') {
      return false;
    }
    return true;
  }

  private async removeJob(jobId: string): Promise<void> {
    const existingJob = await this.queue.getJob(jobId);
    if (!existingJob) {
      return;
    }
    await existingJob.remove();
  }

  private getJobId(
    userId: string,
    entityType: BookmarkEntityType,
    entityId: string,
  ): string {
    return `bookmark-reminder:${userId}:${entityType}:${entityId}`;
  }
}

export const bookmarkReminderService = new BookmarkReminderService();

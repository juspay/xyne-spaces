import { Request, Response } from 'express';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { vespaBackfillQueue } from '@/queues/vespaQueue';
import {
  messageSchema,
  channelSchema,
  projectSchema,
  ticketSchema,
  mailSchema,
  fileSchema,
  appSchema,
  SubApp,
} from '@/vespa/src/types';
import { AttachmentEntityType, ChannelType, Prisma } from '@prisma/client';
import { isSupportedMimeType } from '@/services/fileProcessor';

type BackfillFilters = {
  channelType?: ChannelType;
};

function parseBackfillFilters(raw: unknown): BackfillFilters | null {
  if (!raw) return null;
  if (typeof raw !== 'string') {
    throw new Error('filters must be a JSON string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('filters must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('filters must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const channelType = typeof obj.channelType === 'string' ? obj.channelType.trim() : undefined;

  if (channelType && channelType.toUpperCase() !== ChannelType.EMAIL) {
    throw new Error('Only channelType=EMAIL is supported currently');
  }

  return channelType ? { channelType: ChannelType.EMAIL } : null;
}

/**
 * Admin controller for Vespa backfill operations
 * Provides endpoints to trigger data ingestion into Vespa
 */
export class AdminBackfillController {
  private static readonly BATCH_SIZE = 100;

  /**
   * Backfill messages to Vespa - Transform-at-queue-time approach
   * Only backfills messages updated within the specified time range
   * If no timeframe is provided, backfills all messages
   */
  private static async backfillMessages(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {};

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(created between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          createdAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(created before ${cutoffTime.toISOString()})`;
        whereClause = {
          createdAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all messages
      timeRange = "all messages (no timeframe limit)";
      whereClause = {}; // No time filter
    }

    logger.info(`🔄 Backfilling messages ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching messages batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const messages = await db.message.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: { createdAt: 'asc' }, // Oldest first based on createdAt
        select: { messageId: true } // Only select ID initially
      });

      if (messages.length === 0) {
        logger.debug('[Backfill] No more messages found.');
        break;
      }

      logger.debug(`[Backfill] Found ${messages.length} messages. Transforming and queueing...`);

      // Transform and queue each message
      for (const messageRef of messages) {
        try {
          // Queue only the ID - worker will handle the processing
      await vespaBackfillQueue.addJob({
        schema: messageSchema,
        jobType: 'feed',
        docId: messageRef.messageId,
        userId: undefined // backfill jobs don't have a specific user
      });
      totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform message ${messageRef.messageId}:`, error);
          // Continue with other messages
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} messages...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} messages for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill channels to Vespa - Transform-at-queue-time approach
   * Only backfills channels updated within the specified time range
   * If no timeframe is provided, backfills all channels
   */
  private static async backfillChannels(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {};

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(updated between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(updated before ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all channels
      timeRange = "all channels (no timeframe limit)";
      whereClause = {}; // No time filter
    }

    logger.info(`🔄 Backfilling channels ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching channels batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const channels = await db.channel.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: cutoffTime ? { updatedAt: 'asc' } : { createdAt: 'asc' }, // Use updatedAt if filtering by time, otherwise createdAt
        select: { id: true, workspaceId: true } // Select ID and workspaceId
      });

      if (channels.length === 0) {
        logger.debug('[Backfill] No more channels found.');
        break;
      }

      logger.debug(`[Backfill] Found ${channels.length} channels. Transforming and queueing...`);

      // Transform and queue each channel
      for (const channelRef of channels) {
        try {
          // Queue only the ID - worker will handle the processing
        await vespaBackfillQueue.addJob({
          schema: channelSchema,
          jobType: 'feed',
          docId: channelRef.id,
          userId: undefined, // backfill jobs don't have a specific user
          workspaceId: channelRef.workspaceId,
        });
        totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform channel ${channelRef.id}:`, error);
          // Continue with other channels
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} channels...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} channels for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill projects to Vespa - Transform-at-queue-time approach
   * Only backfills projects updated within the specified time range
   * If no timeframe is provided, backfills all projects
   */
  private static async backfillProjects(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {};

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(updated between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(updated before ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all projects
      timeRange = "all projects (no timeframe limit)";
      whereClause = {}; // No time filter
    }

    logger.info(`🔄 Backfilling projects ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching projects batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const projects = await db.project.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: cutoffTime ? { updatedAt: 'asc' } : { createdAt: 'asc' }, // Use updatedAt if filtering by time, otherwise createdAt
        select: { id: true, workspaceId: true } // Select ID and workspaceId
      });

      if (projects.length === 0) {
        logger.debug('[Backfill] No more projects found.');
        break;
      }

      logger.debug(`[Backfill] Found ${projects.length} projects. Transforming and queueing...`);

      // Transform and queue each project
      for (const projectRef of projects) {
        try {
          // Queue only the ID - worker will handle the processing
        await vespaBackfillQueue.addJob({
          schema: projectSchema,
          jobType: 'feed',
          docId: projectRef.id,
          userId: undefined, // backfill jobs don't have a specific user
          workspaceId: projectRef.workspaceId,
        });
        totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform project ${projectRef.id}:`, error);
          // Continue with other projects
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} projects...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} projects for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill apps (xyne-apps catalog) to the Vespa `app` schema.
   * Queues a feed job per app; the worker re-fetches the row and derives
   * workspaceId + creator identity from the creator's user record (mapApp).
   */
  private static async backfillApps(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let whereClause: Prisma.AppsWhereInput = {};
    if (cutoffTime) {
      whereClause = fromTime
        ? { updatedAt: { gte: fromTime, lte: cutoffTime } }
        : { updatedAt: { lte: cutoffTime } };
    }

    logger.info('🔄 Backfilling apps...');

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      const apps = await db.apps.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        // `id` is a unique tiebreaker: without it, ties on createdAt/updatedAt make
        // skip/take pagination unstable (rows repeat across pages, others get skipped
        // and never queued). Seeded apps share a timestamp, which exposed this.
        orderBy: cutoffTime
          ? [{ updatedAt: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });

      if (apps.length === 0) break;

      for (const app of apps) {
        try {
          await vespaBackfillQueue.addJob({ schema: appSchema, jobType: 'feed', docId: app.id });
          totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to queue app ${app.id}:`, error);
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Queued ${totalQueued} apps...`);
    }

    logger.info(`✓ Queued ${totalQueued} apps for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill tickets to Vespa - Transform-at-queue-time approach
   * Only backfills tickets updated within the specified time range
   * If no timeframe is provided, backfills all tickets
   */
  private static async backfillTickets(
    cutoffTime?: Date,
    fromTime?: Date | null,
    filters?: BackfillFilters | null,
  ): Promise<number> {
    let timeRange: string;
    let whereClause: any = {};

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(updated between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(updated before ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all tickets
      timeRange = "all tickets (no timeframe limit)";
      whereClause = {}; // No time filter
    }

    const filterLabel = filters?.channelType === ChannelType.EMAIL ? ' (channelType=EMAIL)' : '';
    logger.info(`🔄 Backfilling tickets ${timeRange}${filterLabel}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching tickets batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);
      //Todo: The ticket itself should contain ticketType as email or other types instead of joining with channel. This will optimize the query and speed up the backfill process. For now, we are joining with channel to filter by email type tickets.
      const tickets = filters?.channelType === ChannelType.EMAIL
        ? await db.$queryRaw<{ id: string; workspaceId: string }[]>(Prisma.sql`
            SELECT t.id, t."workspaceId"
            FROM "tickets" t
            JOIN "channels" ch ON ch.id = t."channelId"
            WHERE ch.type = ${ChannelType.EMAIL}::"ChannelType"
            ${cutoffTime && fromTime
              ? Prisma.sql`AND t."updatedAt" >= ${fromTime} AND t."updatedAt" <= ${cutoffTime}`
              : cutoffTime
              ? Prisma.sql`AND t."updatedAt" <= ${cutoffTime}`
              : Prisma.sql``}
            ${cutoffTime
              ? Prisma.sql`ORDER BY t."updatedAt" ASC`
              : Prisma.sql`ORDER BY t."createdAt" ASC`}
            LIMIT ${AdminBackfillController.BATCH_SIZE}
            OFFSET ${skip};
          `)
        : await db.ticket.findMany({
            where: whereClause,
            take: AdminBackfillController.BATCH_SIZE,
            skip,
            orderBy: cutoffTime ? { updatedAt: 'asc' } : { createdAt: 'asc' }, // Use updatedAt if filtering by time, otherwise createdAt
            select: { id: true, workspaceId: true } // Select ID and workspaceId
          });

      if (tickets.length === 0) {
        logger.debug('[Backfill] No more tickets found.');
        break;
      }

      logger.debug(`[Backfill] Found ${tickets.length} tickets. Transforming and queueing...`);

      // Transform and queue each ticket
      for (const ticketRef of tickets) {
        try {
          // Queue only the ID - worker will handle the processing
        await vespaBackfillQueue.addJob({
          schema: ticketSchema,
          jobType: 'feed',
          docId: ticketRef.id,
          userId: undefined, // backfill jobs don't have a specific user
          workspaceId: ticketRef.workspaceId,
        });
        totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform ticket ${ticketRef.id}:`, error);
          // Continue with other tickets
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} tickets...`);
    }

      logger.info(`✓ Transformed and queued ${totalQueued} tickets for ingestion`);
      return totalQueued;
  }

  /**
   * Backfill mail (Desk emails) to Vespa - Transform-at-queue-time approach.
   * Reads from the Email (mail) Postgres table and queues per-row jobs into the
   * Vespa Redis queue; the worker fetches + maps via mapEmail() and feeds Vespa.
   * If no timeframe is provided, backfills all emails.
   */
  private static async backfillMail(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {};

    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(created between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          createdAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(created before ${cutoffTime.toISOString()})`;
        whereClause = {
          createdAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      timeRange = 'all mail (no timeframe limit)';
      whereClause = {};
    }

    logger.info(`🔄 Backfilling mail ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching mail batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const emails = await db.email.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (emails.length === 0) {
        logger.debug('[Backfill] No more mail found.');
        break;
      }

      logger.debug(`[Backfill] Found ${emails.length} mail. Transforming and queueing...`);

      for (const emailRef of emails) {
        try {
          await vespaBackfillQueue.addJob({
            schema: mailSchema,
            jobType: 'feed',
            docId: emailRef.id,
            userId: undefined,
          });
          totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform mail ${emailRef.id}:`, error);
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} mail...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} mail for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill canvases to Vespa - Transform-at-queue-time approach
   * Only backfills canvases updated within the specified time range
   * If no timeframe is provided, backfills all canvases
   */
  private static async backfillCanvases(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {};

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(updated between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(updated before ${cutoffTime.toISOString()})`;
        whereClause = {
          updatedAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all canvases
      timeRange = "all canvases (no timeframe limit)";
      whereClause = {}; // No time filter
    }

    logger.info(`🔄 Backfilling canvases ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching canvases batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const canvases = await db.canvas.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: cutoffTime ? { updatedAt: 'asc' } : { createdAt: 'asc' },
        select: { id: true } // Only select ID (Canvas has no workspaceId field)
      });

      if (canvases.length === 0) {
        logger.debug('[Backfill] No more canvases found.');
        break;
      }

      logger.debug(`[Backfill] Found ${canvases.length} canvases. Transforming and queueing...`);

      // Transform and queue each canvas
      for (const canvasRef of canvases) {
        try {
          // Queue only the ID - worker will handle the processing
          await vespaBackfillQueue.addJob({
            schema: fileSchema,
            jobType: 'feed',
            docId: canvasRef.id,
            userId: undefined, // backfill jobs don't have a specific user
            app: SubApp.CANVAS,
          });
          totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform canvas ${canvasRef.id}:`, error);
          // Continue with other canvases
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} canvases...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} canvases for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill chat attachments to Vespa - Transform-at-queue-time approach
   * Only backfills message attachments with entityType=CHAT updated within the specified time range
   * If no timeframe is provided, backfills all chat attachments
   */
  private static async backfillChatAttachments(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {
      entityType: AttachmentEntityType.CHAT || AttachmentEntityType.IMPACT, // Backfill both chat attachments
    };

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(updated between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          ...whereClause,
          updatedAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(updated before ${cutoffTime.toISOString()})`;
        whereClause = {
          ...whereClause,
          updatedAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all chat attachments
      timeRange = "all chat attachments (no timeframe limit)";
    }

    logger.info(`🔄 Backfilling chat attachments ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching chat attachments batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const attachments = await db.messageAttachment.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdBy: true, mimetype: true, workspaceId: true } // Select ID, createdBy, mimetype, and workspaceId
      });

      if (attachments.length === 0) {
        logger.debug('[Backfill] No more chat attachments found.');
        break;
      }

      logger.debug(`[Backfill] Found ${attachments.length} chat attachments. Transforming and queueing...`);

      // Transform and queue each attachment
      for (const attachmentRef of attachments) {
        try {
          // Skip if MIME type is not supported
          if (!isSupportedMimeType(attachmentRef.mimetype)) {
            logger.debug(`[Backfill] Skipping chat attachment ${attachmentRef.id} due to unsupported MIME type: ${attachmentRef.mimetype}`);
            continue;
          }

          // Queue only the ID - worker will handle the processing
          await vespaBackfillQueue.addJob({
            schema: fileSchema,
            jobType: 'feed',
            docId: attachmentRef.id,
            userId: attachmentRef.createdBy,
            app: SubApp.CHAT_ATTACHMENT,
            workspaceId: attachmentRef.workspaceId,
          });
          totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform chat attachment ${attachmentRef.id}:`, error);
          // Continue with other attachments
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} chat attachments...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} chat attachments for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill ticket attachments to Vespa - Transform-at-queue-time approach
   * Only backfills message attachments with entityType=TICKET updated within the specified time range
   * If no timeframe is provided, backfills all ticket attachments
   */
  private static async backfillTicketAttachments(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {
      entityType: AttachmentEntityType.TICKET,
    };

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(updated between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          ...whereClause,
          updatedAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(updated before ${cutoffTime.toISOString()})`;
        whereClause = {
          ...whereClause,
          updatedAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all ticket attachments
      timeRange = "all ticket attachments (no timeframe limit)";
    }

    logger.info(`🔄 Backfilling ticket attachments ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching ticket attachments batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const attachments = await db.messageAttachment.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdBy: true, mimetype: true, workspaceId: true } // Select ID, createdBy, mimetype, and workspaceId
      });

      if (attachments.length === 0) {
        logger.debug('[Backfill] No more ticket attachments found.');
        break;
      }

      logger.debug(`[Backfill] Found ${attachments.length} ticket attachments. Transforming and queueing...`);

      // Transform and queue each attachment
      for (const attachmentRef of attachments) {
        try {
          // Skip if MIME type is not supported
          if (!isSupportedMimeType(attachmentRef.mimetype)) {
            logger.debug(`[Backfill] Skipping ticket attachment ${attachmentRef.id} due to unsupported MIME type: ${attachmentRef.mimetype}`);
            continue;
          }

          // Queue only the ID - worker will handle the processing
          await vespaBackfillQueue.addJob({
            schema: fileSchema,
            jobType: 'feed',
            docId: attachmentRef.id,
            userId: attachmentRef.createdBy,
            app: SubApp.TICKET_ATTACHMENT,
            workspaceId: attachmentRef.workspaceId,
          });
          totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform ticket attachment ${attachmentRef.id}:`, error);
          // Continue with other attachments
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} ticket attachments...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} ticket attachments for ingestion`);
    return totalQueued;
  }

  /**
   * Backfill transcripts to Vespa - Transform-at-queue-time approach
   * Only backfills calls with transcripts updated within the specified time range
   * If no timeframe is provided, backfills all calls with transcripts
   */
  private static async backfillTranscripts(cutoffTime?: Date, fromTime?: Date | null): Promise<number> {
    let timeRange: string;
    let whereClause: any = {
      transcript: {
        not: null,
      },
    };

    // Build where clause based on provided timeframe
    if (cutoffTime) {
      if (fromTime) {
        timeRange = `(updated between ${fromTime.toISOString()} and ${cutoffTime.toISOString()})`;
        whereClause = {
          ...whereClause,
          updatedAt: {
            gte: fromTime,
            lte: cutoffTime,
          },
        };
      } else {
        timeRange = `(updated before ${cutoffTime.toISOString()})`;
        whereClause = {
          ...whereClause,
          updatedAt: {
            lte: cutoffTime,
          },
        };
      }
    } else {
      // No timeframe provided - get all calls with transcripts
      timeRange = "all calls with transcripts (no timeframe limit)";
    }

    logger.info(`🔄 Backfilling transcripts ${timeRange}...`);

    let skip = 0;
    let totalQueued = 0;

    while (true) {
      logger.debug(`[Backfill] Fetching calls with transcripts batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);

      const calls = await db.call.findMany({
        where: whereClause,
        take: AdminBackfillController.BATCH_SIZE,
        skip,
        orderBy: cutoffTime ? { updatedAt: 'asc' } : { createdAt: 'asc' },
        select: { id: true } // Only select ID (Call has no workspaceId field)
      });

      if (calls.length === 0) {
        logger.debug('[Backfill] No more calls with transcripts found.');
        break;
      }

      logger.debug(`[Backfill] Found ${calls.length} calls with transcripts. Transforming and queueing...`);

      // Transform and queue each call with transcript
      for (const callRef of calls) {
        try {
          // Queue only the ID - worker will handle the processing
          await vespaBackfillQueue.addJob({
            schema: fileSchema,
            jobType: 'feed',
            docId: callRef.id,
            userId: undefined, // backfill jobs don't have a specific user
            app: SubApp.TRANSCRIPT,
          });
          totalQueued++;
        } catch (error) {
          logger.error(`[Backfill] Failed to transform transcript ${callRef.id}:`, error);
          // Continue with other transcripts
        }
      }

      skip += AdminBackfillController.BATCH_SIZE;
      logger.info(`  Transformed and queued ${totalQueued} transcripts...`);
    }

    logger.info(`✓ Transformed and queued ${totalQueued} transcripts for ingestion`);
    return totalQueued;
  }

  /**
   * Trigger Vespa backfill for all or specific schemas
   * This endpoint returns immediately after starting the backfill process in the background
   * Example: POST /api/admin/vespa-backfill?schemas=messages,channels
   */
  public static async triggerBackfill(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      logger.info(`🚀 Admin backfill endpoint triggered by user: ${user?.email || 'unknown'}`);
      logger.debug(`[Backfill] Query params: ${JSON.stringify(req.query)}`);

      // Get query parameters
      const schemasParam = req.query.schemas as string | undefined;
      const fromTimestampParam = req.query.fromTimestamp as string | undefined;
      const filtersParam = req.query.filters as string | undefined;
      const queueName = req.query.queueName as string;

      // Determine which schemas to backfill
      const requestedSchemas = schemasParam
        ? schemasParam.split(',').map(s => s.trim().toLowerCase())
        : ['messages', 'channels', 'tickets', 'projects', 'canvases', 'transcripts', 'chat_attachments', 'ticket_attachments', 'mail', 'app'];

      // Parse fromTimestamp if provided, otherwise start from the beginning
      let fromTime: Date | null = null;
      if (fromTimestampParam) {
        try {
          fromTime = new Date(fromTimestampParam);
          if (isNaN(fromTime.getTime())) {
            throw new Error('Invalid timestamp format');
          }
          logger.info(`📅 Using provided fromTimestamp: ${fromTime.toISOString()}`);
        } catch (error) {
          res.status(400).json({
            success: false,
            error: 'Invalid fromTimestamp parameter',
            message: 'fromTimestamp must be a valid ISO 8601 date string',
            timestamp: new Date().toISOString(),
          } as ApiResponse);
          return;
        }
      } else {
        logger.info(`📅 No fromTimestamp provided - will backfill from the beginning`);
      }

      const validSchemas = ['messages', 'channels', 'tickets', 'projects', 'canvases', 'transcripts', 'chat_attachments', 'ticket_attachments', 'mail', 'app'];
      const schemasToBackfill = requestedSchemas.filter(s => validSchemas.includes(s));

      if (schemasToBackfill.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid schemas parameter',
          message: `Valid schemas: ${validSchemas.join(', ')}`,
          timestamp: new Date().toISOString(),
        } as ApiResponse);
        return;
      }


      let filters: BackfillFilters | null = null;
      if (filtersParam) {
        try {
          filters = parseBackfillFilters(filtersParam);
        } catch (error) {
          res.status(400).json({
            success: false,
            error: 'Invalid filters parameter',
            message: error instanceof Error ? error.message : 'Invalid filters parameter',
            timestamp: new Date().toISOString(),
          } as ApiResponse);
          return;
        }
      }

      if (filters && !schemasToBackfill.includes('tickets')) {
        res.status(400).json({
          success: false,
          error: 'Filters are only supported for tickets backfill',
          message: 'Remove filters or include tickets in schemas.',
          timestamp: new Date().toISOString(),
        } as ApiResponse);
        return;
      }

      logger.info(`📊 Backfilling schemas: ${schemasToBackfill.join(', ')}`);

      // Get initial queue stats
      const initialStats = await vespaBackfillQueue.getStats(queueName);

      // Generate a unique job ID for tracking
      const backfillJobId = `backfill-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Capture cutoff time NOW only if a fromTime is provided
      // If no fromTime is provided, we will backfill all records
      const cutoffTime = fromTime ? new Date() : undefined;

      // Prepare response data
      const responseData: any = {
        message: 'Backfill started in background',
        backfillJobId,
        schemasToBackfill,
        fromTimestamp: fromTime ? fromTime.toISOString() : null,
        initialQueueStats: initialStats,
        statusEndpoint: '/api/admin/vespa-backfill/stats',
        filters: filters ?? null,
      };

      // Add time info based on whether we have a timeframe
      if (cutoffTime) {
        responseData.toTimestamp = cutoffTime.toISOString();
        responseData.timeRange = fromTime
          ? `${fromTime.toISOString()} to ${cutoffTime.toISOString()}`
          : `beginning to ${cutoffTime.toISOString()}`;
      } else {
        responseData.toTimestamp = null;
        responseData.timeRange = 'All records (no timeframe limit)';
      }

      // Return immediately - backfill will run in background
      res.status(202).json({
        success: true,
        data: responseData,
        timestamp: new Date().toISOString(),
      } as ApiResponse);

      // Execute backfill asynchronously in the background (fire and forget)
      // No await here - let it run independently
      AdminBackfillController.executeBackfillInBackground(
        schemasToBackfill,
        backfillJobId,
        queueName,
        cutoffTime,
        fromTime,
        filters,
      )
        .catch((error) => {
          logger.error(`❌ Background backfill failed for job ${backfillJobId}:`, error);
        });

    } catch (error) {
      logger.error('❌ Backfill trigger failed:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to trigger backfill operation',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    }
  }

  /**
   * Execute backfill in the background without blocking the API response
   * This method is called asynchronously and runs independently
   */
  private static async executeBackfillInBackground(
    schemasToBackfill: string[],
    backfillJobId: string,
    queueName: string,
    cutoffTime?: Date,
    fromTime?: Date | null,
    filters?: BackfillFilters | null,
  ): Promise<void> {
    try {
      const timeRangeStr = cutoffTime
        ? `${fromTime ? fromTime.toISOString() : 'beginning'} to ${cutoffTime.toISOString()}`
        : 'no time limit (all records)';

      logger.info(`🔄 Starting background backfill job: ${backfillJobId}`);
      logger.info(`📅 Time range: ${timeRangeStr}`);

      const stats: Record<string, number> = {};

      if (schemasToBackfill.includes('projects')) {
        stats.projects = await AdminBackfillController.backfillProjects(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('channels')) {
        stats.channels = await AdminBackfillController.backfillChannels(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('messages')) {
        stats.messages = await AdminBackfillController.backfillMessages(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('tickets')) {
        stats.tickets = await AdminBackfillController.backfillTickets(cutoffTime, fromTime, filters);
      }

      if (schemasToBackfill.includes('canvases')) {
        stats.canvases = await AdminBackfillController.backfillCanvases(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('transcripts')) {
        stats.transcripts = await AdminBackfillController.backfillTranscripts(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('chat_attachments')) {
        stats.chat_attachments = await AdminBackfillController.backfillChatAttachments(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('ticket_attachments')) {
        stats.ticket_attachments = await AdminBackfillController.backfillTicketAttachments(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('mail')) {
        stats.mail = await AdminBackfillController.backfillMail(cutoffTime, fromTime);
      }

      if (schemasToBackfill.includes('app')) {
        stats.app = await AdminBackfillController.backfillApps(cutoffTime, fromTime);
      }

      const totalQueued = Object.values(stats).reduce((sum, count) => sum + count, 0);
      const finalStats = await vespaBackfillQueue.getStats(queueName);

      logger.info(`✅ Background backfill job ${backfillJobId} completed successfully`);
      logger.info(`📊 Total jobs queued: ${totalQueued}`);
      logger.info(`📊 Final queue stats: ${JSON.stringify(finalStats)}`);
    } catch (error) {
      logger.error(`❌ Background backfill job ${backfillJobId} failed:`, error);
      throw error;
    }
  }

  /**
   * Get Vespa queue statistics
   *
   * @route GET /api/admin/vespa-backfill/stats
   * @access Authenticated users
   */
  public static async getQueueStats(req: Request, res: Response): Promise<void> {
    try {
      const queueName = req.query.queueName as string;

      logger.debug('[Backfill] Fetching queue stats...');
      const stats = await vespaBackfillQueue.getStats(queueName);
      logger.debug(`[Backfill] Queue stats: ${JSON.stringify(stats)}`);

      res.status(200).json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to get queue stats:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to get queue statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    }
  }

  
  /**
   * Get queue jobs with pagination and state filter
   * Query params: page, limit, state (waiting|active|delayed|completed|failed|all)
   */
  public static async getJobsWithState(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 100;
      const state = (req.query.state as string) || 'failed';
      const queueName = req.query.queueName as string;

      // Validate state parameter
      const validStates = ['waiting', 'active', 'delayed', 'completed', 'failed', 'all'];
      if (!validStates.includes(state)) {
        res.status(400).json({
          success: false,
          error: 'Invalid state parameter',
          message: `State must be one of: ${validStates.join(', ')}`,
          timestamp: new Date().toISOString(),
        } as ApiResponse);
        return;
      }

      const result = await vespaBackfillQueue.getJobs(
        page,
        limit,
        state as 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'all',
        queueName
      );

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to get queue jobs:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get queue jobs',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    }
  }

  /**
   * Retry all failed jobs
   *
   * @route POST /api/admin/vespa-backfill/retry-failed
   * @access Authenticated users
   */
  public static async retryFailedJobs(req: Request, res: Response): Promise<void> {
    try {
      const queueName = req.query.queueName as string;
      // Use the centralized retryAllFailedJobs function from vespaBullQueue
      const result = await vespaBackfillQueue.retryAllFailedJobs(queueName);

      res.status(200).json({
        success: true,
        message: `Retried ${result.success} out of ${result.total} failed jobs`,
        details: {
          total: result.total,
          succeeded: result.success,
          failed: result.failed,
          errors: result.errors.length > 0 ? result.errors : undefined,
        },
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to retry jobs:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retry jobs',
        message: error instanceof Error ? error.message : 'Unknown error'
      } as ApiResponse);
    }
  }

  /**
   * Clear jobs by state
   *
   * @route DELETE /api/admin/vespa-backfill/jobs
   * @access Authenticated users
   * @query state - Job state to clear: waiting, active, delayed, completed, failed, or all (required)
   */
  public static async clearJobsByState(req: Request, res: Response): Promise<void> {
    try {
      const state = req.query.state as string;
      const queueName = req.query.queueName as string;

      // Validate state parameter
      const validStates: readonly string[] = ['wait', 'active', 'delayed', 'completed', 'failed', 'all'];
      if (!state || !validStates.includes(state)) {
        res.status(400).json({
          success: false,
          error: 'Invalid or missing state parameter',
          message: `State must be one of: ${validStates.join(', ')}`,
          timestamp: new Date().toISOString(),
        } as ApiResponse);
        return;
      }

      const queue = vespaBackfillQueue.getQueue(queueName);
      if (!queue) {
        res.status(500).json({
          success: false,
          error: 'Vespa queue not initialized',
          timestamp: new Date().toISOString(),
        } as ApiResponse);
        return;
      }

      // Get stats before clearing for reporting
      const statsBefore = await vespaBackfillQueue.getStats(queueName);

      if (state === 'all') {
        // Clear all states
        // Use queue.clean for states it supports
        await Promise.all([
          queue.clean(0, 'completed'),
          queue.clean(0, 'failed'), 
          queue.clean(0, 'wait'), 
          queue.clean(0, 'active') ,  
          queue.clean(0, 'delayed'),
         
        ]);
      } else {
        // queue.clean supports 'completed' and 'failed'
        await queue.clean(0, state as 'completed' | 'failed' | 'wait' | 'active' | 'delayed');
      } 

      const statsAfter = await vespaBackfillQueue.getStats(queueName);

      res.status(200).json({
        success: true,
        message: `Cleared all ${state} jobs`,
        details: {
          state,
          jobsRemovedCount: statsBefore.total - statsAfter.total,
          statsBefore,
          statsAfter,
        },
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      logger.error(`Failed to clear jobs:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear jobs',
        message: error instanceof Error ? error.message : 'Unknown error'
      } as ApiResponse);
    }
  }
  
}

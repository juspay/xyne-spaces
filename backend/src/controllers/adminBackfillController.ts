// import { Request, Response } from 'express';
// import { ApiResponse } from '@/types/express';
// import { logger } from '@/utils/logger';
// import { db } from '@/database/client';
// import { extractAllMentions } from '@/utils/mentionParser';
// import {
//   queueMessageIngestion,
//   queueChannelIngestion,
//   queueProjectIngestion,
//   queueTicketIngestion,
//   queueUserIngestion,
//   vespaQueue,
// } from '@/queues/vespaQueue';

// /**
//  * Admin controller for Vespa backfill operations
//  * Provides endpoints to trigger data ingestion into Vespa
//  */
// export class AdminBackfillController {
//   private static readonly BATCH_SIZE = 100;

//   /**
//    * Backfill messages to Vespa
//    * Only backfills messages created BEFORE the backfill started
//    */
//   private static async backfillMessages(orgName: string = 'default', cutoffTime: Date): Promise<number> {
//     logger.info(`🔄 Backfilling messages (created before ${cutoffTime.toISOString()})...`);

//     let skip = 0;
//     let totalQueued = 0;

//     while (true) {
//       logger.debug(`[Backfill] Fetching messages batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);
//       const messages = await db.message.findMany({
//         where: {
//           createdAt: {
//             lt: cutoffTime, // Only messages created BEFORE backfill started
//           },
//         },
//         take: AdminBackfillController.BATCH_SIZE,
//         skip,
//         orderBy: { createdAt: 'asc' }, // Oldest first
//       });

//       if (messages.length === 0) {
//         logger.debug('[Backfill] No more messages found.');
//         break;
//       }

//       logger.debug(`[Backfill] Found ${messages.length} messages. Queueing...`);

//       // Queue each message with complete data
//       for (const message of messages) {
//         // Fetch sender, attachments, reactions, and conversation for each message
//         const [sender, attachments, reactions, conversation] = await Promise.all([
//           db.user.findUnique({ where: { id: message.senderId } }),
//           db.messageAttachment.findMany({
//             where: {
//               entityId: message.messageId,
//               entityType: 'CHAT'
//             }
//           }),
//           db.reaction.findMany({
//             where: {
//               messageId: message.messageId
//             }
//           }),
//           db.conversation.findUnique({ where: { conversationId: message.conversationId } })
//         ]);

//         // Calculate mentions
//         const mentions = extractAllMentions(message.content || '');

//         // Get replies only if this is the initial message
//         let replyCount = 0;
//         let replyUsersCount = 0;
//         if (conversation?.initialMessageId === message.messageId) {
//           // Get count efficiently
//           replyCount = await db.message.count({
//             where: {
//               conversationId: message.conversationId,
//               createdAt: { gt: message.createdAt }
//             }
//           });

//           // Only fetch senderId field for better performance
//           const replies = await db.message.findMany({
//             where: {
//               conversationId: message.conversationId,
//               createdAt: { gt: message.createdAt }
//             },
//             select: { senderId: true }
//           });

//           replyUsersCount = new Set(replies.map(r => r.senderId).filter(id => id !== message.senderId)).size;
//         }

//         // Combine data for Vespa with all required fields (consistent with repository)
//         const messageWithRelations = {
//           ...message,
//           sender,
//           attachments,
//           mentions: mentions.userIds || [],
//           threadId: message.conversationId,
//           replyCount,
//           reactions: reactions.length,
//           replyUsersCount,
//           channelId: conversation?.channelId || '', // Required for transformer
//           updatedAt: new Date((message as any).updatedAt || message.createdAt),
//           deletedAt: (message as any).deletedAt ? new Date((message as any).deletedAt) : undefined,
//           createdBy: sender?.email, // Send user email instead of ID
//         };

//         await queueMessageIngestion(messageWithRelations, 'feed', orgName);
//         totalQueued++;
//       }

//       skip += AdminBackfillController.BATCH_SIZE;
//       logger.info(`  Queued ${totalQueued} messages...`);
//     }

//     logger.info(`✓ Queued ${totalQueued} messages for ingestion`);
//     return totalQueued;
//   }

//   /**
//    * Backfill attachments to Vespa
//    */
  
//   /**
//    * Backfill channels to Vespa
//    * Only backfills channels created BEFORE the backfill started
//    */
//   private static async backfillChannels(orgName: string = 'default', cutoffTime: Date): Promise<number> {
//     logger.info(`🔄 Backfilling channels (created before ${cutoffTime.toISOString()})...`);

//     let skip = 0;
//     let totalQueued = 0;

//     while (true) {
//       logger.debug(`[Backfill] Fetching channels batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);
//       const channels = await db.channel.findMany({
//         where: {
//           createdAt: {
//             lt: cutoffTime, // Only channels created BEFORE backfill started
//           },
//         },
//         take: AdminBackfillController.BATCH_SIZE,
//         skip,
//         orderBy: { createdAt: 'asc' }, // Oldest first
//       });

//       if (channels.length === 0) {
//         logger.debug('[Backfill] No more channels found.');
//         break;
//       }

//       logger.debug(`[Backfill] Found ${channels.length} channels. Queueing...`);

//       // Queue each channel with complete data
//       for (const channel of channels) {
//         // Fetch creator user's name and channel participants
//         const [createdByUser, channelParticipants] = await Promise.all([
//           db.user.findUnique({
//             where: { id: channel.createdBy },
//             select: { email: true }
//           }),
//           db.channelParticipant.findMany({
//             where: { channelId: channel.id }
//           })
//         ]);

//         // Extract user IDs for permissions
//         const permissions = channelParticipants.map(p => p.userId);

//         const channelWithAdditionalData = {
//           ...channel,
//           creator: createdByUser?.email, // Send user email in creator field
//           // createdBy and ownerId will remain as user IDs (from channel object)
//           permissions,
//           memberCount: channelParticipants.length
//         };
//        console.log(`[VESPA-FLOW] Channel createdBy ${channel.id}: Final creator value being sent:`, channelWithAdditionalData.creator);
//         await queueChannelIngestion(channelWithAdditionalData, 'feed', orgName);
//         totalQueued++;
//       }

//       skip += AdminBackfillController.BATCH_SIZE;
//       logger.info(`  Queued ${totalQueued} channels...`);
//     }

//     logger.info(`✓ Queued ${totalQueued} channels for ingestion`);
//     return totalQueued;
//   }

//   /**
//    * Backfill projects to Vespa
//    * Only backfills projects created BEFORE the backfill started
//    */
//   private static async backfillProjects(orgName: string = 'default', cutoffTime: Date): Promise<number> {
//     logger.info(`🔄 Backfilling projects (created before ${cutoffTime.toISOString()})...`);

//     let skip = 0;
//     let totalQueued = 0;

//     while (true) {
//       logger.debug(`[Backfill] Fetching projects batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);
//       const projects = await db.project.findMany({
//         where: {
//           createdAt: {
//             lt: cutoffTime, // Only projects created BEFORE backfill started
//           },
//         },
//         take: AdminBackfillController.BATCH_SIZE,
//         skip,
//         orderBy: { createdAt: 'asc' }, // Oldest first
//       });

//       if (projects.length === 0) {
//         logger.debug('[Backfill] No more projects found.');
//         break;
//       }

//       logger.debug(`[Backfill] Found ${projects.length} projects. Queueing...`);

//       // Queue each project with complete data
//       for (const project of projects) {
//         // Get all stages for this project (through boards)
//         const boards = await db.board.findMany({
//           where: {
//             projectId: project.id
//           }
//         });

//         const boardIds = boards.map(b => b.id);

//         const stages = await db.stage.findMany({
//           where: {
//             boardId: {
//               in: boardIds
//             }
//           },
//           orderBy: {
//             sequenceNumber: 'asc'
//           }
//         });

//         // Fetch user emails for createdBy and updatedBy
//         const [createdByUser, updatedByUser] = await Promise.all([
//           db.user.findUnique({ where: { id: project.createdBy }, select: { email: true } }),
//           project.updatedBy ? db.user.findUnique({ where: { id: project.updatedBy }, select: { email: true } }) : Promise.resolve(null)
//         ]);

//         // Combine data with stages and user emails (consistent with repository)
//         const projectWithStages = {
//           ...project,
//           createdBy: createdByUser?.email, // Send email instead of ID
//           updatedBy: updatedByUser?.email, // Send email instead of ID
//           stages: stages.map(s => s.name), // Send only stage names as array
//           updatedAt: new Date((project as any).updatedAt || project.createdAt),
//           createdAt: new Date(project.createdAt),
//         };

//         await queueProjectIngestion(projectWithStages, 'feed', orgName);
//         totalQueued++;
//       }

//       skip += AdminBackfillController.BATCH_SIZE;
//       logger.info(`  Queued ${totalQueued} projects...`);
//     }

//     logger.info(`✓ Queued ${totalQueued} projects for ingestion`);
//     return totalQueued;
//   }

//   /**
//    * Backfill tickets to Vespa
//    * Only backfills tickets created BEFORE the backfill started
//    */
//   private static async backfillTickets(orgName: string = 'default', cutoffTime: Date): Promise<number> {
//     logger.info(`🔄 Backfilling tickets (created before ${cutoffTime.toISOString()})...`);

//     let skip = 0;
//     let totalQueued = 0;

//     while (true) {
//       logger.debug(`[Backfill] Fetching tickets batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);
//       const tickets = await db.ticket.findMany({
//         where: {
//           createdAt: {
//             lt: cutoffTime, // Only tickets created BEFORE backfill started
//           },
//         },
//         take: AdminBackfillController.BATCH_SIZE,
//         skip,
//         orderBy: { createdAt: 'asc' }, // Oldest first
//       });

//       if (tickets.length === 0) {
//         logger.debug('[Backfill] No more tickets found.');
//         break;
//       }

//       logger.debug(`[Backfill] Found ${tickets.length} tickets. Queueing...`);

//       // Queue each ticket with complete data
//       for (const ticket of tickets) {
//         // Get additional data needed for ticket (consistent with repository)
//         const [workflow, subTicketMapping, createdByUser, conversation] = await Promise.all([
//           db.workflow.findFirst({
//             where: { ticketId: ticket.id },
//             orderBy: { createdAt: "desc" }
//           }),
//           db.ticketSubTicketMapping.findFirst({
//             where: { subTicketId: ticket.id }
//           }),
//           db.user.findUnique({
//             where: { id: ticket.createdBy },
//             select: { email: true, name: true }
//           }),
//           // Get conversation to fetch channelId
//           ticket.conversationId ? db.conversation.findUnique({
//             where: { conversationId: ticket.conversationId },
//             select: { channelId: true }
//           }) : Promise.resolve(null)
//         ]);

//         // Combine data with additional fields (consistent with repository)
//         const ticketWithAdditionalData = {
//           ...ticket,
//           createdBy: createdByUser?.email,
//           workflowType: workflow?.workflowType || "default",
//           parentTicketId: subTicketMapping?.ticketId || "",
//           ownerEmail: createdByUser?.email || "",
//           channelId: conversation?.channelId || "", // Include channelId for Vespa channelRef
//         };

//         await queueTicketIngestion(ticketWithAdditionalData, "feed", orgName);
//         totalQueued++;
//       }
//       skip += AdminBackfillController.BATCH_SIZE;
//       logger.info(`  Queued ${totalQueued} tickets...`);
//     }

//     logger.info(`✓ Queued ${totalQueued} tickets for ingestion`);
//     return totalQueued;
//   }

//   /**
//    * Backfill users to Vespa
//    * Only backfills users created BEFORE the backfill started
//    */
//   private static async backfillUsers(orgName: string = 'default', cutoffTime: Date): Promise<number> {
//     logger.info(`🔄 Backfilling users (created before ${cutoffTime.toISOString()})...`);

//     let skip = 0;
//     let totalQueued = 0;

//     while (true) {
//       logger.debug(`[Backfill] Fetching users batch: skip=${skip}, take=${AdminBackfillController.BATCH_SIZE}`);
//       const users = await db.user.findMany({
//         where: {
//           createdAt: {
//             lt: cutoffTime, // Only users created BEFORE backfill started
//           },
//         },
//         take: AdminBackfillController.BATCH_SIZE,
//         skip,
//         orderBy: { createdAt: 'asc' }, // Oldest first
//       });

//       if (users.length === 0) {
//         logger.debug('[Backfill] No more users found.');
//         break;
//       }

//       logger.debug(`[Backfill] Found ${users.length} users. Queueing...`);

//       // Queue each user with their data
//       for (const user of users) {
//         // Fetch user group mappings for this user
//         const userGroupMappings = await db.userGroupMapping.findMany({
//           where: { userId: user.id },
//           select: { userGroupId: true }
//         });

//         const userGroupIds = userGroupMappings.map(m => m.userGroupId);

//         // Combine data for Vespa with all required fields
//         const userWithGroups = {
//           ...user,
//           userGroupIds, // Add user group IDs array
//         };

//         await queueUserIngestion(userWithGroups, 'feed', orgName);
//         totalQueued++;
//       }

//       skip += AdminBackfillController.BATCH_SIZE;
//       logger.info(`  Queued ${totalQueued} users...`);
//     }

//     logger.info(`✓ Queued ${totalQueued} users for ingestion`);
//     return totalQueued;
//   }

//   /**
//    * Trigger Vespa backfill for all or specific schemas
//    * This endpoint returns immediately after starting the backfill process in the background
//    *
//    * @route POST /api/admin/vespa-backfill
//    * @access Authenticated users
//    *
//    * Query parameters:
//    * - schemas: comma-separated list of schemas to backfill (messages, attachments, channels, projects, tickets)
//    * - orgName: organization name (default: 'default')
//    *
//    * Example: POST /api/admin/vespa-backfill?schemas=messages,channels&orgName=acme
//    */
//   public static async triggerBackfill(req: Request, res: Response): Promise<void> {
//     try {
//       const user = (req as any).user;
//       logger.info(`🚀 Admin backfill endpoint triggered by user: ${user?.email || 'unknown'}`);
//       logger.debug(`[Backfill] Query params: ${JSON.stringify(req.query)}`);

//       // Get query parameters
//       const schemasParam = req.query.schemas as string | undefined;
//       const orgName = (req.query.orgName as string) || process.env.DEFAULT_ORG_NAME || 'default';

//       // Determine which schemas to backfill
//       const requestedSchemas = schemasParam
//         ? schemasParam.split(',').map(s => s.trim().toLowerCase())
//         : ['messages', 'attachments', 'channels', 'projects', 'tickets', 'users'];

//       const validSchemas = ['messages', 'attachments', 'channels', 'projects', 'tickets', 'users'];
//       const schemasToBackfill = requestedSchemas.filter(s => validSchemas.includes(s));

//       if (schemasToBackfill.length === 0) {
//         res.status(400).json({
//           success: false,
//           error: 'Invalid schemas parameter',
//           message: `Valid schemas: ${validSchemas.join(', ')}`,
//           timestamp: new Date().toISOString(),
//         } as ApiResponse);
//         return;
//       }

//       logger.info(`📊 Backfilling schemas: ${schemasToBackfill.join(', ')} for org: ${orgName}`);

//       // Get initial queue stats
//       const initialStats = await vespaQueue.getStats();

//       // Generate a unique job ID for tracking
//       const backfillJobId = `backfill-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

//       // Capture cutoff time NOW - only backfill data created before this moment
//       const cutoffTime = new Date();

//       // Return immediately - backfill will run in background
//       res.status(202).json({
//         success: true,
//         data: {
//           message: 'Backfill started in background',
//           backfillJobId,
//           orgName,
//           schemasToBackfill,
//           cutoffTime: cutoffTime.toISOString(),
//           initialQueueStats: initialStats,
//           statusEndpoint: '/api/admin/vespa-backfill/stats',
//         },
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);

//       // Execute backfill asynchronously in the background (fire and forget)
//       // No await here - let it run independently
//       AdminBackfillController.executeBackfillInBackground(schemasToBackfill, orgName, backfillJobId, cutoffTime)
//         .catch((error) => {
//           logger.error(`❌ Background backfill failed for job ${backfillJobId}:`, error);
//         });

//     } catch (error) {
//       logger.error('❌ Backfill trigger failed:', error);

//       res.status(500).json({
//         success: false,
//         error: 'Failed to trigger backfill operation',
//         message: error instanceof Error ? error.message : 'Unknown error',
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Execute backfill in the background without blocking the API response
//    * This method is called asynchronously and runs independently
//    */
//   private static async executeBackfillInBackground(
//     schemasToBackfill: string[],
//     orgName: string,
//     backfillJobId: string,
//     cutoffTime: Date
//   ): Promise<void> {
//     try {
//       logger.info(`🔄 Starting background backfill job: ${backfillJobId}`);
//       logger.info(`📅 Cutoff time: ${cutoffTime.toISOString()} (only data created before this time will be backfilled)`);

//       const stats: Record<string, number> = {};

//       if (schemasToBackfill.includes('projects')) {
//         stats.projects = await AdminBackfillController.backfillProjects(orgName, cutoffTime);
//       }

//       if (schemasToBackfill.includes('users')) {
//         stats.users = await AdminBackfillController.backfillUsers(orgName, cutoffTime);
//       }

//       if (schemasToBackfill.includes('channels')) {
//         stats.channels = await AdminBackfillController.backfillChannels(orgName, cutoffTime);
//       }

//       if (schemasToBackfill.includes('messages')) {
//         stats.messages = await AdminBackfillController.backfillMessages(orgName, cutoffTime);
//       }

//       if (schemasToBackfill.includes('tickets')) {
//         stats.tickets = await AdminBackfillController.backfillTickets(orgName, cutoffTime);
//       }

//       const totalQueued = Object.values(stats).reduce((sum, count) => sum + count, 0);
//       const finalStats = await vespaQueue.getStats();

//       logger.info(`✅ Background backfill job ${backfillJobId} completed successfully`);
//       logger.info(`📊 Total jobs queued: ${totalQueued}`);
//       logger.info(`📊 Final queue stats: ${JSON.stringify(finalStats)}`);
//     } catch (error) {
//       logger.error(`❌ Background backfill job ${backfillJobId} failed:`, error);
//       throw error;
//     }
//   }

//   /**
//    * Get Vespa queue statistics
//    *
//    * @route GET /api/admin/vespa-backfill/stats
//    * @access Authenticated users
//    */
//   public static async getQueueStats(_req: Request, res: Response): Promise<void> {
//     try {
//       logger.debug('[Backfill] Fetching queue stats...');
//       const stats = await vespaQueue.getStats();
//       logger.debug(`[Backfill] Queue stats: ${JSON.stringify(stats)}`);

//       res.status(200).json({
//         success: true,
//         data: stats,
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to get queue stats:', error);

//       res.status(500).json({
//         success: false,
//         error: 'Failed to get queue statistics',
//         message: error instanceof Error ? error.message : 'Unknown error',
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Get failed jobs
//    *
//    * @route GET /api/admin/vespa-backfill/failed
//    * @access Authenticated users
//    */
//   public static async getFailedJobs(_req: Request, res: Response): Promise<void> {
//     try {
//       const failedJobs = await vespaQueue.queue.getFailed();

//       const formattedJobs = failedJobs.map(job => ({
//         id: job.id,
//         schema: job.data.schema,
//         docId: job.data.docId,
//         jobType: job.data.jobType,
//         failedReason: job.failedReason,
//         attemptsMade: job.attemptsMade,
//         timestamp: job.timestamp,
//         finishedOn: job.finishedOn
//       }));

//       res.status(200).json({
//         success: true,
//         count: formattedJobs.length,
//         data: formattedJobs,
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to get failed jobs:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to get failed jobs',
//         message: error instanceof Error ? error.message : 'Unknown error'
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Retry all failed jobs
//    *
//    * @route POST /api/admin/vespa-backfill/retry-failed
//    * @access Authenticated users
//    */
//   public static async retryFailedJobs(_req: Request, res: Response): Promise<void> {
//     try {
//       const failedJobs = await vespaQueue.queue.getFailed();

//       if (failedJobs.length === 0) {
//         res.status(200).json({
//           success: true,
//           message: 'No failed jobs to retry',
//           timestamp: new Date().toISOString(),
//         } as ApiResponse);
//         return;
//       }

//       logger.info(`Retrying ${failedJobs.length} failed jobs...`);

//       const results = await Promise.allSettled(failedJobs.map(job => job.retry()));
//       const succeeded = results.filter(r => r.status === 'fulfilled').length;

//       res.status(200).json({
//         success: true,
//         message: `Retried ${succeeded} out of ${failedJobs.length} failed jobs`,
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to retry jobs:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to retry jobs',
//         message: error instanceof Error ? error.message : 'Unknown error'
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Clear failed jobs
//    *
//    * @route DELETE /api/admin/vespa-backfill/failed
//    * @access Authenticated users
//    */
//   public static async clearFailedJobs(_req: Request, res: Response): Promise<void> {
//     try {
//       await vespaQueue.queue.clean(0, 'failed');

//       res.status(200).json({
//         success: true,
//         message: 'Cleared all failed jobs',
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to clear failed jobs:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to clear failed jobs',
//         message: error instanceof Error ? error.message : 'Unknown error'
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Clear entire queue (waiting, delayed, and completed jobs)
//    * WARNING: This is a destructive operation - use with caution!
//    *
//    * @route DELETE /api/admin/vespa-backfill/queue
//    * @access Authenticated users
//    */
//   public static async clearQueue(_req: Request, res: Response): Promise<void> {
//     try {
//       logger.warn('[ADMIN] Clearing entire Vespa queue - this will remove all waiting, delayed, and completed jobs');

//       const statsBefore = await vespaQueue.getStats();

//       await vespaQueue.clearQueue();

//       const statsAfter = await vespaQueue.getStats();

//       res.status(200).json({
//         success: true,
//         message: 'Queue cleared successfully',
//         data: {
//           jobsRemovedCount: statsBefore.waiting + statsBefore.delayed + statsBefore.completed,
//           statsBefore,
//           statsAfter,
//         },
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to clear queue:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to clear queue',
//         message: error instanceof Error ? error.message : 'Unknown error'
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Pause the queue (stop processing new jobs)
//    * Active jobs will continue, but no new jobs will be picked up
//    *
//    * @route POST /api/admin/vespa-backfill/pause
//    * @access Authenticated users
//    */
//   public static async pauseQueue(_req: Request, res: Response): Promise<void> {
//     try {
//       logger.warn('[ADMIN] Pausing Vespa queue - no new jobs will be processed');

//       await vespaQueue.queue.pause();

//       const stats = await vespaQueue.getStats();

//       res.status(200).json({
//         success: true,
//         message: 'Queue paused successfully. Active jobs will complete, but no new jobs will be processed.',
//         data: {
//           queueStats: stats,
//         },
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to pause queue:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to pause queue',
//         message: error instanceof Error ? error.message : 'Unknown error'
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Resume the queue (start processing jobs again)
//    *
//    * @route POST /api/admin/vespa-backfill/resume
//    * @access Authenticated users
//    */
//   public static async resumeQueue(_req: Request, res: Response): Promise<void> {
//     try {
//       logger.info('[ADMIN] Resuming Vespa queue - job processing will continue');

//       await vespaQueue.queue.resume();

//       const stats = await vespaQueue.getStats();

//       res.status(200).json({
//         success: true,
//         message: 'Queue resumed successfully. Job processing has been restarted.',
//         data: {
//           queueStats: stats,
//         },
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to resume queue:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to resume queue',
//         message: error instanceof Error ? error.message : 'Unknown error'
//       } as ApiResponse);
//     }
//   }

//   /**
//    * Get queue status (is paused or active)
//    *
//    * @route GET /api/admin/vespa-backfill/status
//    * @access Authenticated users
//    */
//   public static async getQueueStatus(_req: Request, res: Response): Promise<void> {
//     try {
//       const isPaused = await vespaQueue.queue.isPaused();
//       const stats = await vespaQueue.getStats();

//       res.status(200).json({
//         success: true,
//         data: {
//           isPaused,
//           status: isPaused ? 'paused' : 'active',
//           queueStats: stats,
//         },
//         timestamp: new Date().toISOString(),
//       } as ApiResponse);
//     } catch (error) {
//       logger.error('Failed to get queue status:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to get queue status',
//         message: error instanceof Error ? error.message : 'Unknown error'
//       } as ApiResponse);
//     }
//   }
// }

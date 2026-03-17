import { logger } from '../../utils/logger';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { WebClient } from '@slack/web-api';
import { config } from '../../config/env';
import { postMessage } from './utils/postMessage';
import { getMigrationMessageBlocks, getMigrationMessageFallbackText } from './utils/blockKit';
import { DatabaseClient } from "../../database/client";
import { encrypt } from '../../services/encryptionService';
import { fetchSlackUserInfo } from '../../integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { UserRepository } from '../../database/repositories/users';
import { conversationService } from '../../services/conversationService';
import { findOrCreateUser, ingestConversationSlack } from '../scripts/ingestConversationSlack';
import { generateTitle } from '../../services/agents/title-generator';
import { ExternalEntityType, MessageDirection, VespaInsertionStatus, VespaOperationType } from '@prisma/client';
import { fetchThreadReplies, transformReply, type UserInfoCache, type SlackReply, SlackMessage } from './utils/extractConversation';
import { ticketSchema } from '@xyne/vespa-ts';
import { NAMESPACE } from '../../vespa/vespaConfig';
import { vespaQueue } from '../../queues/vespaQueue';


const ENABLE_NOTIFICATIONS = true;

interface BitbotTicket {
   id: string;
   assigned_username: string | null;
   created_at: string;
   eta: string | null;
   jira_issue_id: string;
   reporter_name: string;
   slack_thread_ts: string;
   stage: string | null;
   task_description: string;
   task_type: string;
}

interface MigrationJiraffeInput {
   syncDate?: string;
   allTicketsChecked?: boolean;
   userId?: string;
   channelId?: string;
   xyneSpaceChannelId?: string;
}

interface BoardValidationResult {
   boardMapper: Map<string, string>;
   defaultBoardId: string;
}

async function validateAndMapBoards(
   projectId: string,
   requiredBoards: string[],
   channelId: string,
   messageTs: string | null
): Promise<BoardValidationResult | null> {
   const db = DatabaseClient.getInstance();

   // Get all boards for the project
   const allBoards = await db.board.findMany({
      where: { projectId },
   });

   // Check if all required boards exist
   const existingBoardNames = new Set(allBoards.map(board => board.name));
   const missingBoards = requiredBoards.filter(boardName => !existingBoardNames.has(boardName));

   if (missingBoards.length > 0) {
      const missingBoardNames = missingBoards.join(', ');
      if (ENABLE_NOTIFICATIONS && messageTs) {
         await postMessage({
            channelId: channelId,
            text: `❌ Missing boards in channel project: ${missingBoardNames}`,
            threadTs: messageTs,
         });
      }
      logger.error('[Migration] Missing required boards in project', {
         projectId,
         missingBoards,
      });
      return null;
   }

   if (allBoards.length === 0) {
      if (ENABLE_NOTIFICATIONS && messageTs) {
         await postMessage({
            channelId: channelId,
            text: `❌ No board found for project ${projectId}.`,
            threadTs: messageTs,
         });
      }
      logger.error('[Migration] No board found for project', {
         projectId,
      });
      return null;
   }

   // Build board mapper: board name -> board id
   const boardMapper = new Map<string, string>();
   for (const board of allBoards) {
      boardMapper.set(board.name, board.id);
   }

   // Get the first board as fallback for ticket creation
   const defaultBoardId = allBoards[0].id;

   return {
      boardMapper,
      defaultBoardId,
   };
}

async function fetchTicketsFromBitbot(
   slackChannelId: string,
   syncDate?: string
): Promise<BitbotTicket[]> {
   const baseUrl = 'https://bitbot.internal.svc.k8s.office.mum.juspay.net';
   const url = new URL(`${baseUrl}/api/internal/migration/tickets`);
   url.searchParams.set('slackChannelId', slackChannelId);
   if (syncDate) {
      url.searchParams.set('date', syncDate);
   }

   const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
   });

   if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bitbot API error: ${response.status} ${response.statusText} - ${errorText}`);
   }

   const ticketResponse = (await response.json()) as { tickets: BitbotTicket[] };
   return ticketResponse.tickets;
}

async function pushVespaJobForTicket(
   ticketId: string,
   userId: string
 ): Promise<void> {
   vespaQueue.addJob({
     schema: ticketSchema,
     jobType: "feed",
     docId: ticketId,
   }).catch(async (error) => {
     logger.error('[Migration] Error queuing Vespa job for ticket:', error);
     try {
       const db = DatabaseClient.getInstance();
       const vespaLogs = db.vespaInsertionLogs;
       if (vespaLogs) {
         await vespaLogs.create({
           data: {
             status: VespaInsertionStatus.FAILED,
             type: VespaOperationType.INSERT,
             entityId: ticketId,
             entityType: ticketSchema,
             namespace: NAMESPACE,
             errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
             errorDetails: JSON.stringify(error),
             userId: userId,
             createdAt: new Date(),
           },
         });
       }
     } catch (dbError) {
       logger.error('[Migration] Failed to log Vespa insertion error to database:', dbError);
     }
   });
 }


async function ingestTicket(
   ticket: BitbotTicket,
   externalSourceName: string,
   channelId: string,
   projectId: string,
   boardMapper: Map<string, string>,
   defaultBoardId: string,
   sourceChannelId: string,
   userRepo: UserRepository,
   userCache: Map<string, { id: string; isDeactivated: boolean }>,
   userInfoCache: UserInfoCache
): Promise<SlackReply[]> {
   const db = DatabaseClient.getInstance();

   // Get or create external source
   let externalSource = await db.externalSource.findFirst({
      where: { name: externalSourceName },
   });

   if (!externalSource) {
      const botToken = config.slackBotToken;
      if (!botToken) {
         throw new Error('SLACK_BOT_TOKEN is not configured');
      }
      externalSource = await db.externalSource.create({
         data: {
            name: externalSourceName,
            sourceType: 'jiraffe',
            displayName: 'Jiraffe Migration',
            channelId: channelId,
            credentials: encrypt(JSON.stringify({ botToken })),
         },
      });
   }

   // Fetch and transform thread replies (in both cases: ticket exists or not)
   const threadReplies: SlackReply[] = [];
   try {
      const botToken = config.slackBotToken;
      if (!botToken) {
         logger.warn('[Migration] SLACK_BOT_TOKEN not configured, skipping thread replies fetch');
      } else {
         const client = new WebClient(botToken);
         const allowedBots = ['JIRAffe'];
         const rawReplies = await fetchThreadReplies(client, sourceChannelId, ticket.slack_thread_ts, allowedBots);

         // Transform each reply
         for (const rawReply of rawReplies) {
            try {
               const transformedReply = await transformReply(rawReply, userInfoCache, true, allowedBots);
               threadReplies.push(transformedReply);
            } catch (error) {
               logger.warn('[Migration] Failed to transform reply', {
                  replyTs: rawReply.ts,
                  error: error instanceof Error ? error.message : 'Unknown error',
               });
               // Continue with next reply
            }
         }
      }
   } catch (error) {
      logger.error('[Migration] Failed to fetch thread replies', {
         ticketId: ticket.id,
         threadTs: ticket.slack_thread_ts,
         error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Continue even if fetch fails
   }

   // Check if ticket already exists
   const existingMessage = await db.externalMessage.findFirst({
      where: {
         externalSourceId: externalSource.id,
         externalId: ticket.id,
         externalThreadId: ticket.slack_thread_ts,
      },
   });

   if (existingMessage) {
      return threadReplies;
   }

   // Get or create user
   const botToken = config.slackBotToken;
   if (!botToken) {
      throw new Error('SLACK_BOT_TOKEN is not configured');
   }

   let userId: string;
   const existingUser = await userRepo.findByMetadataField('slackId', ticket.reporter_name);
   if (existingUser) {
      userId = existingUser.id;
   } else {
      const userInfo = await fetchSlackUserInfo(ticket.reporter_name, botToken);
      if (!userInfo?.profile?.email) {
         throw new Error(`Missing user email for reporter: ${ticket.reporter_name}`);
      }

      userId = await findOrCreateUser(
         userInfo.profile.email,
         userInfo.profile.real_name || userInfo.profile.display_name || ticket.reporter_name,
         userInfo.deleted || false,
         userRepo,
         userCache
      );
      await userRepo.upsertMetaDataField(userId, 'slackId', ticket.reporter_name);
   }

   // Generate title: try AI first, fallback to task_type and JIRA ID
   const fallbackTitle = `${ticket.task_type}: ${ticket.jira_issue_id}`;
   let titleText: string;


   if (ticket.task_description?.trim()) {
      try {
         const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Title generation timeout after 15 seconds')), 15000);
         });
         const titleResult = await Promise.race([
            generateTitle(
               { description: ticket.task_description },
               { userId, channelId }
            ),
            timeoutPromise,
         ]);
         titleText = titleResult.title;
      } catch (error) {
         logger.warn('[Migration] Failed to generate title, using fallback', {
            ticketId: ticket.id,
            error: error instanceof Error ? error.message : 'Unknown error',
         });
         titleText = fallbackTitle;
      }
   } else {
      titleText = fallbackTitle;
   }

   // Create conversation
   const conversation = await conversationService.createConversationWithMessage({
      channelId,
      userId: userId,
      content: `Ticket Created: ${titleText}`,
      createdAt: new Date(ticket.created_at),
   });

   // Find assigned user if assigned_username exists
   let assignedToUserId: string | undefined;
   if (ticket.assigned_username) {
      const assignedUserEmail = `${ticket.assigned_username}@juspay.in`;
      const assignedUser = await userRepo.findByEmail(assignedUserEmail);
      if (assignedUser) {
         assignedToUserId = assignedUser.id;
      }
   }

   // Get board ID from mapper based on task_type (uppercase), fallback to default board
   const boardId = boardMapper.get(ticket.task_type.toUpperCase().replace(/_/g, ' ')) || defaultBoardId;

   // Build description: add JIRA link if title was AI-generated (not fallback)
   let description = ticket.task_description || '';
   if (titleText !== fallbackTitle) {
      const jiraLink = `${description!==''?"\n\n\n":""}https://juspay.atlassian.net/browse/${ticket.jira_issue_id}`;
      description = description ? `${description}${jiraLink}` : jiraLink.trim();
   }

   // Generate xyneId and create ticket
   const { TicketIdService } = await import('../../services/ticketIdService');
   const xyneId = await TicketIdService.generateTicketId(db, projectId);

   const createdTicket = await db.ticket.create({
      data: {
         title: titleText,
         description: description,
         createdBy: userId,
         updatedBy: userId,
         conversationId: conversation.conversation.conversationId,
         channelId: channelId,
         projectId: projectId,
         boardId: boardId,
         stageName: ticket.stage?.replace(/_/g, ' ').toUpperCase() || 'TO BE PICKED',
         xyneId: xyneId,
         ...(assignedToUserId && { assignedTo: assignedToUserId }),
         ...(ticket.eta && { eta: new Date(ticket.eta) }),
         createdAt: new Date(ticket.created_at),
      },
   });

   pushVespaJobForTicket(ticket.id, userId).catch(error => {
      logger.error(`[Slack Jiraffe] Error pushing Vespa job for ticket ${ticket.id}:`, error);
    });

   // Update conversation to link it to the ticket
   await db.conversation.update({
      where: { conversationId: conversation.conversation.conversationId },
      data: { ticketId: createdTicket.id },
   });

   await db.message.update({
      where: { messageId: conversation.message.messageId },
      data: {
        metadata: {
          ticketId: createdTicket.id,
        },
      },
   });

   // Create external message tracking record
   await db.externalMessage.createMany({
      data: [
         {
            externalSourceId: externalSource.id,
            externalId: ticket.id,
            externalThreadId: ticket.slack_thread_ts,
            messageId: "", 
            entityId: createdTicket.id, 
            direction: MessageDirection.INCOMING,
            entityType: 'TICKET' as ExternalEntityType,
         },
         {
            externalSourceId: externalSource.id,
            externalId: ticket.slack_thread_ts,
            externalThreadId: ticket.slack_thread_ts,
            messageId: "", 
            entityId: conversation.message.messageId, 
            direction: MessageDirection.INCOMING,
            entityType: 'MESSAGE' as ExternalEntityType,
         },
      ],
   });
   return threadReplies;
}

export async function runMigrationJiraffe(input: MigrationJiraffeInput) {
   // Validate required fields
   if (!input.userId || !input.channelId || !input.xyneSpaceChannelId ) {
       logger.error('[Migration] User ID, channel ID, and Xyne Space Channel ID are required');
       return;
   }

   if (!input.syncDate && !input.allTicketsChecked) {
       logger.error('[Migration] Sync date or all tickets checked is required for Jiraffe migration');
       return;
   }

   // Validate Xyne Space Channel ID
   if (input.xyneSpaceChannelId) {
       const channelRepo = new ChannelRepository();
       const xyneChannel = await channelRepo.findById(input.xyneSpaceChannelId);

       if (!xyneChannel) {
           if (ENABLE_NOTIFICATIONS && input.userId && config.slackBotToken) {
               const client = new WebClient(config.slackBotToken);
               await client.chat.postEphemeral({
                   channel: input.channelId,
                   user: input.userId,
                   text: '❌ Xyne channel does not exist in database. Please provide a valid Xyne channel ID.',
               });
           }
           logger.error('[Migration] Xyne Space channel not found in database', {
               xyneSpaceChannelId: input.xyneSpaceChannelId,
           });
           return;
       }
   }

   logger.info('[Migration] Starting migration jiraffe', {
      syncDate: input.syncDate,
      allTicketsChecked: input.allTicketsChecked,
      userId: input.userId,
      channelId: input.channelId,
      xyneSpaceChannelId: input.xyneSpaceChannelId,
   });

   // Get Xyne Space channel link
   let xyneSpaceChannelLink: string | undefined;
   if (input.xyneSpaceChannelId) {
       const channelRepo = new ChannelRepository();
       const xyneChannel = await channelRepo.findById(input.xyneSpaceChannelId);
       if (xyneChannel) {
           const channelName = xyneChannel.name;
           xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/chat/${input.xyneSpaceChannelId}|${channelName}>`;
       }
   }

   // Post initial message first
   const syncDate = input.syncDate || undefined;
   const syncOptions = input.allTicketsChecked ? ['All tickets'] : undefined;
   
   const blocks = getMigrationMessageBlocks({
       syncDate: syncDate,
       userId: input.userId,
       syncOptions: syncOptions,
       xyneSpaceChannelId: xyneSpaceChannelLink || input.xyneSpaceChannelId,
       isJiraffeMigration: true,
   });
   const fallbackText = getMigrationMessageFallbackText(syncDate);

   const messageTs = ENABLE_NOTIFICATIONS
       ? await postMessage({
           channelId: input.channelId,
           text: fallbackText,
           blocks,
       })
       : null;

   if (ENABLE_NOTIFICATIONS && messageTs) {
       const migrationType = input.allTicketsChecked 
           ? ' (All tickets)' 
           : input.syncDate 
               ? ` (From: ${input.syncDate})` 
               : '';
       await postMessage({
           channelId: input.channelId,
           text: `🔄 Jiraffe migration initiated${migrationType}`,
           threadTs: messageTs,
       });
   }

   // Get channel, board, and stage before migration starts
   const db = DatabaseClient.getInstance();
   const channel = await db.channel.findUnique({
      where: { id: input.xyneSpaceChannelId },
      include: { project: true },
   });

   if (!channel?.projectId) {
      if (ENABLE_NOTIFICATIONS && messageTs) {
         await postMessage({
            channelId: input.channelId,
            text: '❌ Channel not found or has no project associated.',
            threadTs: messageTs,
         });
      }
      logger.error('[Migration] Channel not found or has no project', {
         channelId: input.xyneSpaceChannelId,
      });
      return;
   }

   const requiredBoards = ['NEW REQUIREMENT', 'FULL PG INTEGRATIONS', 'MONITORING', 'ENHANCEMENT REQUIREMENT', 'FRAMEWORKS', 'ISSUE', 'QUERY'];

   // Validate boards and build mapper
   const boardValidation = await validateAndMapBoards(
      channel.projectId,
      requiredBoards,
      input.channelId,
      messageTs
   );

   if (!boardValidation) {
      return; // Error already logged and notified
   }

   const { boardMapper, defaultBoardId } = boardValidation;

   let jiraffeTickets: BitbotTicket[];
   try {
      jiraffeTickets = await fetchTicketsFromBitbot(input.channelId, input.syncDate);
   } catch (error) {
      if (ENABLE_NOTIFICATIONS && messageTs) {
         await postMessage({
            channelId: input.channelId,
            text: `❌ Failed to fetch tickets from Bitbot API`,
            threadTs: messageTs,
         });
      }
      return;
   }

   const externalSourceName = `jiraffeMigration-${input.channelId}`;

   // Initialize repositories and user cache (same pattern as ingestConversationSlack)
   const userRepo = new UserRepository();
   const userCache = new Map<string, { id: string; isDeactivated: boolean }>();
   const userInfoCache: UserInfoCache = new Map();

   const ticketCount = jiraffeTickets.length;

   if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
         channelId: input.channelId,
         text: `🔄 Jiraffe migration extracted ${ticketCount} tickets `,
         threadTs: messageTs,
      });
   }
   let counter = 0;
   const BATCH_SIZE = 10;

   // Process tickets in batches of BATCH_SIZE
   try {
      for (let i = 0; i < jiraffeTickets.length; i += BATCH_SIZE) {
      const batch = jiraffeTickets.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(jiraffeTickets.length / BATCH_SIZE);

      logger.info('[Migration] Processing batch', {
         batchNumber,
         totalBatches,
         batchSize: batch.length,
         startIndex: i,
      });

      // Process each ticket in the current batch
      for (const ticket of batch) {
         try {
            const externalSource = await db.externalSource.findFirst({
               where: { name: externalSourceName },
            });
            
            const existingMessage = externalSource
               ? await db.externalMessage.findFirst({
                    where: {
                       externalSourceId: externalSource.id,
                       externalId: ticket.id,
                       externalThreadId: ticket.slack_thread_ts,
                    },
                 })
               : null;
            
            const threadReplies = await ingestTicket(
               ticket,
               externalSourceName,
               input.xyneSpaceChannelId,
               channel.projectId,
               boardMapper,
               defaultBoardId,
               input.channelId,
               userRepo,
               userCache,
               userInfoCache,
            );
            
            counter++;
            const ticketStatus = existingMessage ? '(Already migrated)' : '(New ticket created)';
            
            if (ENABLE_NOTIFICATIONS && messageTs) {
               await postMessage({
                  channelId: input.channelId,
                  text: `🔄 Jiraffe ${counter} tickets processed, ${ticketStatus}`,
                  threadTs: messageTs,
               });
            }
            
            if (threadReplies.length > 0) {
               if (ENABLE_NOTIFICATIONS && messageTs) {
                  await postMessage({
                     channelId: input.channelId,
                     text: `🔄 Ticket ${counter}: Extracted ${threadReplies.length} associated thread replies`,
                     threadTs: messageTs,
                  });
               }
               try {
                  const slackMessage: SlackMessage = {
                     externalId: ticket.slack_thread_ts,
                     content: "",
                     replies: threadReplies,
                  };
                  await ingestConversationSlack({
                     slackMessages: [slackMessage],
                     externalSourceName: externalSourceName,
                     channelId: input.xyneSpaceChannelId,
                     onlyReplies: true,
                  });
                  if (ENABLE_NOTIFICATIONS && messageTs) {
                     await postMessage({
                        channelId: input.channelId,
                        text: `🔄 Ticket ${counter}: Ingested/updated ${threadReplies.length} associated thread replies`,
                        threadTs: messageTs,
                     });
                  }
                  logger.info('[Migration] Ticket ingested with replies', {
                     ticketId: ticket.id,
                     replyCount: threadReplies.length,
                  });
               } catch (ingestError) {
                  const errorMessage = ingestError instanceof Error ? ingestError.message : 'Unknown error';
                  if (ENABLE_NOTIFICATIONS && messageTs) {
                     await postMessage({
                        channelId: input.channelId,
                        text: `❌ Ticket ${counter}: Failed to ingest thread replies - ${errorMessage}`,
                        threadTs: messageTs,
                     });
                  }
               }
            }
         } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (ENABLE_NOTIFICATIONS && messageTs) {
               await postMessage({
                  channelId: input.channelId,
                  text: `❌ Ticket ${counter + 1}: Failed to ingest ticket - ${errorMessage}`,
                  threadTs: messageTs,
               });
            }
            logger.error('[Migration] Failed to ingest ticket', {
               ticketId: ticket.id,
               error: errorMessage,
            });
         }
      }

      // After processing batch, wait 60 seconds before next batch (except for the last batch)
      if (i + BATCH_SIZE < jiraffeTickets.length) {
         const timeoutSeconds = 60;
         const timeoutMs = timeoutSeconds * 1000;

         if (ENABLE_NOTIFICATIONS && messageTs) {
            await postMessage({
               channelId: input.channelId,
               text: `⏸️ Batch ${batchNumber}/${totalBatches} completed (${batch.length} tickets). Waiting ${timeoutSeconds} seconds before processing next batch...`,
               threadTs: messageTs,
            });
         }

         logger.info('[Migration] Batch completed, starting timeout', {
            batchNumber,
            timeoutSeconds,
         });

         // Wait for 60 seconds
         await new Promise(resolve => setTimeout(resolve, timeoutMs));

         if (ENABLE_NOTIFICATIONS && messageTs) {
            await postMessage({
               channelId: input.channelId,
               text: `▶️ Timeout completed. Resuming migration with batch ${batchNumber + 1}/${totalBatches}...`,
               threadTs: messageTs,
            });
         }

         logger.info('[Migration] Timeout completed, resuming migration', {
            nextBatchNumber: batchNumber + 1,
         });
      }
      }  
   } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (ENABLE_NOTIFICATIONS && messageTs) {
         await postMessage({
            channelId: input.channelId,
            text: `❌ Migration stopped due to error: ${errorMessage}. Processed ${counter} tickets out of ${ticketCount} total tickets before stopping.`,
            threadTs: messageTs,
         });
      }
      throw error; 
   }

   if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
         channelId: input.channelId,
         text: `✅ Jiraffe migration completed successfully! Processed ${counter} tickets out of ${ticketCount} total tickets.`,
         threadTs: messageTs,
      });
   }
   logger.info('[Migration] Jiraffe migration completed', {
      totalTickets: ticketCount,
      processedTickets: counter,
      channelId: input.channelId,
   });
}

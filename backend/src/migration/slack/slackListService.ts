import { SlackFile } from "./utils/extractConversation";
import { logger } from "../../utils/logger";
import { conversationService } from "../../services/conversationService";
import { UserService } from "../../services/userService";
import { UserRepository } from "../../database/repositories/users";
import { MessageRepository } from "../../database/repositories/messageRepository";
import { TicketRepository } from "../../database/repositories/ticketRepository";
import { DatabaseClient } from "../../database/client";
import { AuthProvider, FormFieldType, VespaInsertionStatus, VespaOperationType } from "@prisma/client";
import { config } from "../../config/env";
import { encrypt } from "../../services/encryptionService";
import { fetchSlackUserInfo, resolveSlackMentions } from "@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver";
import { parseSlackTimestamp } from "../scripts/ingestConversationSlack";
import { ExternalAttachmentService, DownloadedAttachment } from "@/services/externalAttachmentService";
import { ExternalAttachment } from "@/services/externalAttachmentService";
import { escapeForSlackWithMarkdown } from '@clearfeed-ai/slack-to-html';
import { vespaQueue } from "@/queues/vespaQueue";
import { ticketSchema } from "@/vespa/src/types";
import { NAMESPACE } from "@/vespa/vespaConfig";
import { TicketIdService } from "@/services/ticketIdService";
   

function extractUserNameFromEmail(email: string): string {
   const beforeAt = email.split('@')[0];
   const nameParts = beforeAt.split('.');
   return nameParts
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ') || email;
}

export interface SlackListResponse {
    channelId : string,
    ingestionData : SlackListItem[]
}

export interface SlackList {
   title : string,
   eta?: string, 
   stage?: string, 
   createdAt: string, 
   createdBy: string,
   description?: string,
   formData?: Record<string, string>; 
}

export interface SlackConversation {
   text: string,
   user: string,
   ts: string,
   thread_ts: string,
   files?: SlackFile[],
}

export interface SlackListItem {
   listItem : SlackList,
   conversation?: SlackConversation[]
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
     logger.error('[Slack List] Error queuing Vespa job for ticket:', error);
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
       logger.error('[Slack List] Failed to log Vespa insertion error to database:', dbError);
     }
   });
 }

export async function ingestSlackList(channelId: string, projectId: string, boardId: string, formId: string, ingestionData: SlackListItem[]): Promise<void> {
   logger.debug('[Slack List] Ingesting slack list');
   logger.debug('[Slack List] Ingestion Data Length: ' + ingestionData.length);
   
   const userService = new UserService();
   const userRepo = new UserRepository();
   const messageRepo = new MessageRepository();
   const ticketRepo = new TicketRepository();
   const db = DatabaseClient.getInstance();
   
   try {
      for (const item of ingestionData) {
         if (!item.listItem) {
            logger.error('[Slack List] List item is undefined');
            continue;
         }
         if (!item.listItem.title || !item.listItem.createdAt || !item.listItem.createdBy) {
            logger.error('[Slack List] Missing required fields for item: ' + JSON.stringify(item.listItem));
            continue;
         }
         
         // Resolve user ID from email
         let user = await userService.findUserByEmail(item.listItem.createdBy);
         if (!user) {
            const userName = extractUserNameFromEmail(item.listItem.createdBy);
            
            logger.info(`[Slack List] User not found for email: ${item.listItem.createdBy}, creating new user`);
            
            try {
               user = await userRepo.create({
                  email: item.listItem.createdBy,
                  name: userName,
                  providerUserId: `slackListMigration-${item.listItem.createdBy}`,
                  authProvider: AuthProvider.GOOGLE,
               });
               logger.info(`[Slack List] Created new user: ${user.email} (${user.id})`);
            } catch (createError) {
               logger.error(`[Slack List] Failed to create user for email ${item.listItem.createdBy}:`, createError);
               continue;
            }
         }
         
         const resolvedUserId = user.id;
         
         const result = await conversationService.createConversationWithMessage({
            channelId,
            userId: resolvedUserId,
            content: "temp", // Will be updated after conversation creation
            msgType: 'USER',
            isBot: false,
            createdAt: new Date(item.listItem.createdAt as string),
         });

         if (!result || !result.conversation || !result.conversation.conversationId || !result.message || !result.message.messageId) {
            logger.error('[Slack List] Failed to create conversation or message for item: ' + JSON.stringify(item.listItem));
            continue;
         }

         const xyneId = await TicketIdService.generateTicketId(db, projectId);
         
         const ticket = await ticketRepo.createTicket({
            title: item.listItem.title,
            description: item.listItem.description || "",
            createdBy: resolvedUserId,
            updatedBy: resolvedUserId,
            conversationId: result.conversation.conversationId,
            channelId: channelId,
            xyneId: xyneId,
            projectId: projectId,
            boardId: boardId,
            ...(item.listItem.stage && { stageName: item.listItem.stage }),
            ...(item.listItem.eta && { eta: new Date(item.listItem.eta as string) }),
         });

         pushVespaJobForTicket(ticket.id, resolvedUserId).catch(error => {
            logger.error(`[Slack List] Error pushing Vespa job for ticket ${ticket.id}:`, error);
          });

         await messageRepo.update(result.message.messageId, {
            content: "",
            metadata: {
               ticketId: ticket.id,
            },
         });

         await db.conversation.update({
            where: {
               conversationId: result.conversation.conversationId,
            },
            data: {
               ticketId: ticket.id,
            },
         });

         if (item.listItem.formData) {
            for (const [fieldName, value] of Object.entries(item.listItem.formData)) {
               const field = await db.formFields.findFirst({
                  where: {
                     fieldName: fieldName,
                     formId: formId,
                  },
               });
               if (!field) {
                  logger.error('[Slack List] Field not found: ' + fieldName);
                  continue;
               }
               let processedValue: string | string[] = value;
               if (field.fieldType === FormFieldType.USER) {
                  if (typeof value === 'string') {
                     const emailList = value.split(',').map(v => v.trim()).filter(v => v.length > 0);
                     const userIds: string[] = [];
                     for (const email of emailList) {
                        const foundUser = await userService.findUserByEmail(email);
                        if (foundUser) {
                           userIds.push(foundUser.id);
                        } else {
                           logger.warn(`[Slack List] User not found for email: ${email} in field ${fieldName}`);
                        }
                     }
                     if (userIds.length > 0) {
                        processedValue = userIds;
                     } else {
                        logger.warn(`[Slack List] No valid users found for field ${fieldName}. Value: ${value}`);
                        continue;
                     }
                  }
               } else if (field.fieldType === FormFieldType.SINGLE_SELECT) {
                  if (typeof value === 'string') {
                     // For single select, use the value as-is (or first value if comma-separated)
                     const trimmedValue = value.trim();
                     if (field.fieldEnum && Array.isArray(field.fieldEnum) && field.fieldEnum.length > 0) {
                        const enumArray = field.fieldEnum as string[];
                        if (enumArray.includes(trimmedValue)) {
                           processedValue = trimmedValue;
                        } else {
                           logger.warn(`[Slack List] No valid enum value found for field ${fieldName}. Value: ${value}, Available enums: ${JSON.stringify(field.fieldEnum)}`);
                           continue;
                        }
                     } else {
                        processedValue = trimmedValue;
                     }
                  }
               } else if (field.fieldType === FormFieldType.MULTI_SELECT) {
                  if (typeof value === 'string') {
                     // For multi select, split by comma
                     const splitValues = value.split(',').map(v => v.trim()).filter(v => v.length > 0);
                     if (field.fieldEnum && Array.isArray(field.fieldEnum) && field.fieldEnum.length > 0) {
                        const enumArray = field.fieldEnum as string[];
                        const validValues = splitValues.filter(v => enumArray.includes(v));
                        if (validValues.length > 0) {
                           processedValue = validValues;
                        } else {
                           logger.warn(`[Slack List] No valid enum values found for field ${fieldName}. Value: ${value}, Available enums: ${JSON.stringify(field.fieldEnum)}`);
                           continue;
                        }
                     } else {
                        processedValue = splitValues;
                     }
                  }
               } else if (field.fieldType === FormFieldType.DATE) {
                  if (typeof value === 'string') {
                     try {
                        const date = new Date(value);
                        if (isNaN(date.getTime())) {
                           logger.warn(`[Slack List] Invalid date format for field ${fieldName}. Value: ${value}`);
                           continue;
                        }
                        // Format to YYYY-MM-DD
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        processedValue = `${year}-${month}-${day}`;
                     } catch (error) {
                        logger.warn(`[Slack List] Error parsing date for field ${fieldName}. Value: ${value}`, error);
                        continue;
                     }
                  } else {
                     processedValue = value;
                  }
               } else {
                  processedValue = value;
               }
               await db.formEntityValues.create({
                  data: {
                     entityId: ticket.id,
                     entityType: "TICKET",
                     fieldId: field.id,
                     fieldValue: "",
                     actualFieldValue: processedValue,
                  },
               });
            }
         }
         logger.info(`[Slack List] Created ticket: ${ticket.xyneId} (${ticket.id}) for conversation ${result.conversation.conversationId}`);
         if (item.conversation) {
            if (item.conversation.length === 0) {
               logger.error('[Slack List] No conversation found for item: ' + JSON.stringify(item.listItem));
               continue;
            }
            const externalSourceName = `slackListMigration-${channelId}`;
            let externalSource = await db.externalSource.findFirst({
               where: {
                  name: externalSourceName,
               },
            });
            const botToken = config.slackBotToken;
            if (!botToken) {
               logger.error('[Slack List] SLACK_BOT_TOKEN is not configured');
               continue;
            }
            if (!externalSource) {
               
               const encryptedCredentials = encrypt(JSON.stringify({ botToken }));

               externalSource = await db.externalSource.create({
                  data: {
                     name: externalSourceName,
                     sourceType: "slack",
                     displayName: externalSourceName,
                     channelId: channelId,
                     credentials: encryptedCredentials,
                  },
               });
            }
            for (const conv of item.conversation) {
               if (!conv.user || !conv.ts || !conv.thread_ts) {
                  logger.error('[Slack List] Missing required fields for conversation: ' + JSON.stringify(conv));
                  continue;
               }
              const externalMessage = await db.externalMessage.findFirst({
                 where: {
                    externalSourceId: externalSource.id,
                    externalId: conv.ts,
                    externalThreadId: conv.thread_ts,
                 },
              });
              if (externalMessage) {
                 logger.error('[Slack List] External message already exists: ' + JSON.stringify(conv));
                 continue;
              }

              let replyUser = await userRepo.findByMetadataField('slackId', conv.user);
              if (!replyUser) {
                 const userInfo = await fetchSlackUserInfo(conv.user, botToken);
                 if (!userInfo || !userInfo.profile.email) {
                    logger.error('[Slack List] Failed to fetch user info: ' + conv.user);
                    continue;
                 }
                 let newReplyUser = await userRepo.findByEmail(userInfo.profile.email);
                 if (!newReplyUser) {
                    newReplyUser = await userRepo.create({
                       email: userInfo.profile.email,
                       name: userInfo.profile.real_name || userInfo.profile.display_name || extractUserNameFromEmail(userInfo.profile.email),
                       providerUserId: `slackListMigration-${conv.user}`,
                       authProvider: AuthProvider.GOOGLE,
                    });
                 }
                 await userRepo.update(newReplyUser.id, {
                    metadata: {
                       slackId: conv.user,
                    },
                 });
                 replyUser = newReplyUser;
              }

              const replyUserId = replyUser.id;

              const downloadAttachments = async (
               slackFiles: SlackFile[] | undefined
               ): Promise<DownloadedAttachment[]> => {
                  if (!slackFiles || slackFiles.length === 0) {
                  return [];
                  }
            
                  try {
                  const externalAttachments: ExternalAttachment[] = slackFiles.map((file) => ({
                     fileName: file.name,
                     fileUrl: file.url_private,
                     mimeType: file.mimetype,
                     size: file.size,
                  }));
                  return await ExternalAttachmentService.downloadForSource(
                     externalSourceName,
                     externalAttachments,
                     {
                        maxFileSize: 500 * 1024 * 1024, // 50MB
                        timeout: 200000, // 200 seconds
                        scopeType: 'EXTERNAL_MESSAGE',
                        scopeId: externalSourceName,
                     }
                  );
                  } catch (error) {
                  logger.error('[IngestSlack] Failed to download attachments', {
                     error: error instanceof Error ? error.message : 'Unknown error',
                  });
                  return []; // Continue without attachments
                  }
               };

            const downloadedAttachments = await downloadAttachments(conv.files);
            const resolvedText = await resolveSlackMentions(conv.text, botToken);

            if (resolvedText == "" && conv.files && conv.files.length > 0 && downloadedAttachments.length == 0) {
               continue;
            }
              const replyResult = await conversationService.addMessageToConversation({
                 conversationId: result.conversation.conversationId,
                 userId: replyUserId,
                 content: resolvedText == "" ? "temp" : escapeForSlackWithMarkdown(resolvedText),
                 msgType: 'USER',
                 isBot: false,
                 createdAt: parseSlackTimestamp(conv.thread_ts),
                 lastActivityAt: parseSlackTimestamp(conv.thread_ts),
                 uploadedFiles: downloadedAttachments,
              });

              if (replyResult && replyResult.message && replyResult.message.messageId) {
               if (resolvedText == "") {
                  await messageRepo.update(replyResult.message.messageId, {
                     content: "",
                  });
               }
                 await db.externalMessage.create({
                    data: {
                       externalSourceId: externalSource.id,
                       externalId: conv.ts,
                       externalThreadId: conv.thread_ts,
                       entityId: replyResult.message.messageId,
                       messageId: "",
                       entityType: "MESSAGE",
                       direction: "INCOMING",
                    },
                 });
               }
            }
         }
      }
   } catch (error) {
      logger.error('[Slack List] Error ingesting slack list: ' + error);
   }
}
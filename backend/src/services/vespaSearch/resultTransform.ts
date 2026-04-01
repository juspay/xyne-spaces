import { PrismaClient } from '@prisma/client';
   import {
     VespaSearchHit,
     VespaChatMessageDocument,
     VespaTicketDocument,
     VespaChatContainerDocument,
     importedChannelFields,
     User,
     Channel,
     importedTicketFields,
     VespaFileDocument
   } from '@/vespa/src/types';
   import { logger } from '@/utils/logger';
   
   // Frontend-compatible result type (matches DisplaySearchResult from dashboard/src/types/search.ts)
   
   
   export interface TransformedSearchResult {
     id: string;
     type: 'user' | 'conversation' | 'channel' | 'ticket' | 'attachment';
     title: string; // Channel name for messages, document title for others
     subtitle: string;
     context?: string; // Message content for display (used by SearchResultItem)
     relevanceScore: number;
     avatar?: string;
     metadata: {
       timestamp: string;
       channelName?: string;
       status?: string;
       fileSize?: string;
     };
     searchContext?: {
       channelId?: string;
       channelTitle?: string;
       scopeType?: string;
       conversationId?: string;
       messageId?: string;
       replyCount?: number;
       senderId?: string;
       senderName?: string;
       ticketId?: string;
       ticketStatus?: string;
       boardId?: string;
       createdBy?: string;
       creatorName?: string;
       assignedTo?: string;
       assigneeName?: string;
       attachmentId?: string;
       fileName?: string;
       fileSize?: number;
       mimeType?: string;
       internalUrl?: string;
       originalUrl?: string;
       xyneId?: string;
       subApp?: string;
     };
     debugInfo?: {
       matchfeatures?: Record<string, any>;
       rankfeatures?: Record<string, any>;
       prefixBoost?: number;
       originalScore?: number;
     };
   }
   
   interface UserMap {
     [userId: string]: {
       name: string;
       email: string;
     };
   }
   
   interface ChannelMap {
     [channelId: string]: {
       name: string;
     };
   }

interface GmailChunkSummary {
  chunk?: string;
}

   interface GmailMailDocument {
     docId: string;
     sddocname: 'mail';
     subject?: string;
     from?: string;
     timestamp?: number;
     threadId?: string;
     mailId?: string;
     chunks_summary?: Array<string | GmailChunkSummary>;
   }

   interface GmailMailAttachmentDocument {
     docId: string;
     sddocname: 'mail_attachment';
     filename?: string;
     fileType?: string | null;
     timestamp?: number;
     threadId?: string;
     mailId?: string;
     chunks_summary?: Array<string | GmailChunkSummary>;
   }

/**
 * Main transformer function - transforms Vespa search hits to frontend format
 */
export async function transformVespaResults(
     hits: VespaSearchHit[],
     prisma: PrismaClient,
   ): Promise<TransformedSearchResult[]> {
     if (!hits || hits.length === 0) {
       return [];
     }
   
     // Collect all user IDs and channel IDs we need to fetch
     const userIdsToFetch = new Set<string>();
     const channelIdsToFetch = new Set<string>();
   
     hits.forEach((hit) => {
       const doc = hit.fields;
       const docType = doc.docType as string;
   
       // For messages, collect channelId to fetch channel name
       if ((docType === 'message' || docType === 'chat_message') && 'channelId' in doc) {
         channelIdsToFetch.add(doc.channelId as string);
       }
   
       // For attachments, we need the sender's name and channelId
       if ((docType === 'attachment' || docType === 'chat_attachment') && 'userId' in doc) {
         userIdsToFetch.add(doc.userId);
         if ('channelId' in doc) {
           channelIdsToFetch.add(doc.channelId as string);
         }
       }
   
       // For tickets, we need the creator's and assignee's names
       if ((docType === 'ticket')) {
         if ('createdBy' in doc && doc.createdBy) {
           userIdsToFetch.add(doc.createdBy as string);
         }
         if ('assignedTo' in doc && doc.assignedTo) {
           userIdsToFetch.add(doc.assignedTo as string);
         }
       }
   
       // For messages in DMs/Group DMs, we need participant names from permissions
       if ((docType === 'message' || docType === 'chat_message') && 'permissions' in doc) {
         const msgDoc = doc as unknown as VespaChatMessageDocument & importedChannelFields;
         const scopeType = msgDoc.isIm ? 'DM' : msgDoc.isMpim ? 'GROUP_DM' : 'DEFAULT';
         
         // If it's a DM or Group DM and channelName is generic/missing, fetch participant names
         if ((scopeType === 'DM' || scopeType === 'GROUP_DM') && msgDoc.permissions) {
           msgDoc.permissions.forEach((userId: string) => userIdsToFetch.add(userId));
         }
       }
   
       // For channels (DM/Group DM), we might need participant names
       if ((docType === 'channel' || docType === 'chat_container') && 'permissions' in doc) {
         const channelDoc = doc as VespaChatContainerDocument;
         const scopeType = channelDoc.isIm ? 'DM' : channelDoc.isMpim ? 'GROUP_DM' : 'DEFAULT';
         
         if ((scopeType === 'DM' || scopeType === 'GROUP_DM') && channelDoc.permissions) {
           channelDoc.permissions.forEach((userId) => userIdsToFetch.add(userId));
         }
       }
     });
   
     // Batch fetch user data
     const userMap: UserMap = {};
     if (userIdsToFetch.size > 0) {
       const users: User[]  = await prisma.user.findMany({
         where: {
           id: {
             in: Array.from(userIdsToFetch),
           },
         },
         select: {
           id: true,
           name: true,
           email: true,
         },
       });
   
       users.forEach((user) => {
         userMap[user.id] = {
           name: user.name,
           email: user.email,
         };
       });
     }
   
     // Batch fetch channel data
     const channelMap: ChannelMap = {};
     if (channelIdsToFetch.size > 0) {
       const channels: Channel[] = await prisma.channel.findMany({
         where: {
           id: {
             in: Array.from(channelIdsToFetch),
           },
         },
         select: {
           id: true,
           name: true,
         },
       });
   
       channels.forEach((channel) => {
         channelMap[channel.id] = {
           name: channel.name,
         };
       });
     }
   
     // Transform each hit
     return hits.map((hit) => transformSingleHit(hit, userMap));
   }
   
   /**
    * Transform a single Vespa hit to frontend format
    */
   function transformSingleHit(
     hit: VespaSearchHit,
     userMap: UserMap,
   ): TransformedSearchResult {
     const doc = hit.fields;
     const docType = doc.docType as string | undefined;
     const schemaName = 'sddocname' in doc ? String(doc.sddocname || '') : '';
   
   
     const debugInfo = ('matchfeatures' in doc || 'rankfeatures' in doc) ? {
       matchfeatures: 'matchfeatures' in doc ? doc.matchfeatures : undefined,
       rankfeatures: 'rankfeatures' in doc ? doc.rankfeatures : undefined,
       prefixBoost: '_prefixBoost' in doc ? doc._prefixBoost as number:undefined,
       originalScore: '_originalScore' in doc ? doc._originalScore as number:undefined,
     } : undefined;
   
     // Map schema names to handlers
     // Vespa returns schema names like 'chat_message', not enum values like 'message'
     let result: TransformedSearchResult;
     
     switch (docType || schemaName) {
       // case 'user':
       //   result = transformUser(hit, doc as VespaUserDocument);
       //   break;
   
       case 'message':
         result = transformMessage(hit, doc as VespaChatMessageDocument & importedChannelFields);
         break;
       
       // case 'attachment':
       // case 'chat_attachment':
       //   result = transformAttachment(hit, doc as VespaChatAttachmentDocument, userMap, channelMap);
       //   break;
   
      case 'file':
         result = transformFile(hit, doc as VespaFileDocument & Partial<importedChannelFields>);
         break;
   
       case 'ticket':
         result = transformTicket(hit, doc as VespaTicketDocument & importedTicketFields, userMap);
         break;

       case 'mail':
         result = transformMail(hit, doc as unknown as GmailMailDocument);
         break;

       case 'mail_attachment':
         result = transformMailAttachment(hit, doc as unknown as GmailMailAttachmentDocument);
         break;
   
       // case 'channel':
       // case 'chat_container':
       //   result = transformChannel(hit, doc as VespaChatContainerDocument, userMap);
       //   break;
   
       default:
         // Fallback for unknown types - log for debugging
         logger.warn(`Unknown docType encountered: ${docType || schemaName}`, { hitId: hit.id });
         result = {
           id: hit.id,
           type: 'conversation',
           title: 'Unknown Document',
           subtitle: `Type: ${docType || schemaName}`,
           context: JSON.stringify(doc),
           relevanceScore: hit.relevance,
           metadata: {
             timestamp: formatTimestamp(new Date().toISOString()),
           },
         };
     }
   
     // Attach debug info if available
     if (debugInfo) {
       result.debugInfo = {
         matchfeatures: debugInfo.matchfeatures as Record<string, any>,
         rankfeatures: debugInfo.rankfeatures as Record<string, any>,
         prefixBoost: debugInfo.prefixBoost as number,
         originalScore: debugInfo.originalScore as number,
       };
     }
   
     return result;
   }
   
   /**
    * Format timestamp for display
    */
   function formatTimestamp(timestamp: string): string {
     try {
       const date = new Date(timestamp);
       return date.toLocaleString('en-US', {
         timeZone: 'UTC',
         year: 'numeric',
         month: 'short',
         day: 'numeric',
         hour: 'numeric',
         minute: '2-digit',
         hour12: true,
       });
     } catch {
       return timestamp;
     }
   }

   function getSummaryText(
     chunksSummary?: Array<string | GmailChunkSummary>,
   ): string | undefined {
     if (!chunksSummary || chunksSummary.length === 0) {
       return undefined;
     }

     const [firstChunk] = chunksSummary;
     if (typeof firstChunk === 'string') {
       return firstChunk;
     }

     return firstChunk?.chunk;
   }
   
   /**
    * Format file size for display
    */
   // function formatFileSize(bytes?: number): string | undefined {
   //   if (bytes === undefined || bytes === null || isNaN(bytes)) {
   //     return undefined;
   //   }
   
   //   if (bytes === 0) {
   //     return '0 KB';
   //   }
   
   //   const k = 1024;
   //   const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   //   const i = Math.floor(Math.log(bytes) / Math.log(k));
   
   //   return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
   // }
   
   /**
    * Transform user document
    */
   // function transformUser(hit: VespaSearchHit, doc: VespaUserDocument): TransformedSearchResult {
   //   // Handle potentially invalid createdAt timestamp
   //   let timestamp = '';
   //   try {
   //     if (doc.createdAt) {
   //       const date = new Date(doc.createdAt);
   //       if (!isNaN(date.getTime())) {
   //         timestamp = formatTimestamp(date.toISOString());
   //       }
   //     }
   //   } catch (error) {
   //     logger.warn('Invalid createdAt for user:', doc.docId, doc.createdAt);
   //   }
   
   //   return {
   //     id: doc.docId,
   //     type: 'user',
   //     title: doc.name,
   //     subtitle: doc.email,
   //     context: doc.name,
   //     relevanceScore: hit.relevance,
   //     avatar: doc.docId,
   //     metadata: {
   //       timestamp: timestamp || 'N/A',
   //     },
   //   };
   // }
   
   /**
    * Transform message document
    */
   function transformMessage(
     hit: VespaSearchHit,
     doc: VespaChatMessageDocument & importedChannelFields,
   ): TransformedSearchResult {
     const scopeType = doc.isIm ? 'DM' : doc.isMpim ? 'GROUP_DM' : 'DEFAULT';
     
     
     // Generate proper channel title for DMs
     const channelTitle = doc.channelName || 'Unknown Channel';
   
     // Handle potentially invalid createdAt timestamp
     let timestamp = '';
     try {
       if (doc.createdAtTimestamp) {
         const date = new Date(doc.createdAtTimestamp);
         if (!isNaN(date.getTime())) {
           timestamp = formatTimestamp(date.toISOString());
         }
       }
     } catch (error) {
       logger.warn('Invalid createdAt for message:', doc.docId, doc.createdAtTimestamp);
     }
   
     return {
       id: doc.docId,
       type: 'conversation',
       title: channelTitle || 'Unknown Channel',
       subtitle: `By ${doc.username || 'Unknown'}`,
       context: doc.text,
       relevanceScore: hit.relevance,
       avatar: doc.userId,
       metadata: {
         timestamp: timestamp || 'N/A',
         channelName: channelTitle || 'Unknown Channel',
       },
       searchContext: {
         channelId: doc.channelId,
         channelTitle: channelTitle || 'Unknown Channel',
         scopeType: scopeType,
         conversationId: doc.threadId,
         messageId: doc.docId,
         replyCount: doc.replyCount || 0,
         senderId: doc.userId,
         senderName: doc.username,
       },
     };
   }
   
   /**
    * Transform file document
    */
   function transformFile(
     hit: VespaSearchHit,
     doc: VespaFileDocument & Partial<importedChannelFields>,
   ): TransformedSearchResult {
     // Handle potentially invalid createdAt timestamp
     let timestamp = '';
     try {
       if (doc.createdAt) {
         const date = new Date(doc.createdAt);
         if (!isNaN(date.getTime())) {
           timestamp = formatTimestamp(date.toISOString());
         }
       }
     } catch (error) {
       logger.warn('Invalid createdAt for attachment:', doc.docId, doc.createdAt);
     }
   
     return {
       id: doc.docId,
       type: 'attachment',
       title: doc.fileName,
       subtitle: doc.description,
       context: doc.fileName,
       relevanceScore: hit.relevance,
       avatar: doc.ownerId,
      metadata: {
        timestamp: timestamp || 'N/A',
      },
      searchContext: {
        attachmentId: doc.docId,
        fileName: doc.fileName,
        originalUrl: doc.urlOriginal,
        internalUrl: doc.urlInternal,
        subApp: doc.subApp,
        conversationId: doc.conversationId,
        channelId: doc.channelId,
        messageId: doc.messageId,
        ticketId: doc.ticketId,
      },
    };
  }
   
   /**
    * Transform ticket document
    */
   function transformTicket(
     hit: VespaSearchHit,
     doc: VespaTicketDocument & importedTicketFields,
     userMap: UserMap,
   ): TransformedSearchResult {
     // Handle potentially invalid createdAt timestamp
     let timestamp = '';
     try {
       if (doc.createdAtTimestamp) {
         const date = new Date(doc.createdAtTimestamp);
         if (!isNaN(date.getTime())) {
           timestamp = formatTimestamp(date.toISOString());
         }
       }
     } catch (error) {
       logger.warn('Invalid createdAt for ticket:', doc.docId, doc.createdAtTimestamp);
     }
   
     // Get creator and assignee names from userMap
     const creator = userMap[doc.createdBy];
     const creatorName = creator?.name || creator?.email || 'Unknown Creator';
     
     const assignee = doc.assignedTo ? userMap[doc.assignedTo] : null;
     const assigneeName = assignee?.name || assignee?.email || null;
   
      // Build subtitle with all required info
      const subtitleParts = [doc.xyneId, `${doc.status} - ${doc.stage || 'No Stage'}`];
      if (assigneeName) {
        subtitleParts.push(`Assigned to: ${assigneeName}`);
      }
   
     return {
       id: doc.docId,
       type: 'ticket',
       title: doc.title,
       subtitle: subtitleParts.join(' | '),
       context: doc.description,
       relevanceScore: hit.relevance,
       metadata: {
         timestamp: timestamp || 'N/A',
         status: doc.status,
       },
       searchContext: {
         ticketId: doc.docId,
         ticketStatus: doc.status,
         channelId: doc.channelId,
         boardId: doc.boardId,
         createdBy: doc.createdBy,
         creatorName: creatorName,
         assignedTo: doc.assignedTo,
         assigneeName: assigneeName || undefined,
         conversationId: doc.convId,
         xyneId: doc.xyneId,
       },
     };
   }

   function transformMail(
     hit: VespaSearchHit,
     doc: GmailMailDocument,
   ): TransformedSearchResult {
     const timestamp = doc.timestamp
       ? formatTimestamp(new Date(doc.timestamp).toISOString())
       : 'N/A';
     const subject = doc.subject?.trim() || '(No subject)';
     const sender = doc.from?.trim() || 'Unknown sender';
     const summary = getSummaryText(doc.chunks_summary);
     const originalUrl = doc.threadId
       ? `https://mail.google.com/mail/u/0/#all/${doc.threadId}`
       : undefined;

     return {
       id: doc.docId,
       type: 'conversation',
       title: subject,
       subtitle: `Email from ${sender}`,
       context: summary || subject,
       relevanceScore: hit.relevance,
       metadata: {
         timestamp,
         channelName: 'Gmail',
       },
       searchContext: {
         channelTitle: 'Gmail',
         conversationId: doc.threadId,
         messageId: doc.mailId || doc.docId,
         senderName: sender,
         originalUrl,
       },
     };
   }

   function transformMailAttachment(
     hit: VespaSearchHit,
     doc: GmailMailAttachmentDocument,
   ): TransformedSearchResult {
     const timestamp = doc.timestamp
       ? formatTimestamp(new Date(doc.timestamp).toISOString())
       : 'N/A';
     const filename = doc.filename?.trim() || 'Untitled attachment';
     const summary = getSummaryText(doc.chunks_summary);
     const mimeType = doc.fileType || undefined;
     const originalUrl = doc.threadId
       ? `https://mail.google.com/mail/u/0/#all/${doc.threadId}`
       : undefined;

     return {
       id: doc.docId,
       type: 'attachment',
       title: filename,
       subtitle: mimeType ? `Email attachment | ${mimeType}` : 'Email attachment',
       context: summary || filename,
       relevanceScore: hit.relevance,
       metadata: {
         timestamp,
         channelName: 'Gmail',
       },
       searchContext: {
         attachmentId: doc.docId,
         fileName: filename,
         mimeType,
         conversationId: doc.threadId || doc.mailId,
         messageId: doc.mailId || doc.docId,
         originalUrl,
       },
     };
   }

   /**
    * Transform channel document
    */
   // function transformChannel(
   //   hit: VespaSearchHit,
   //   doc: VespaChatContainerDocument,
   //   userMap: UserMap,
   // ): TransformedSearchResult {
   //   const scopeType = doc.isIm ? 'DM' : doc.isMpim ? 'GROUP_DM' : 'DEFAULT';

   //   // Generate proper channel name for DMs
   //   const channelName = generateChannelTitle(
   //     doc.channelName,
   //     doc.permissions,
   //     userMap,
   //     scopeType,
   //   );

   //   // Handle potentially invalid createdAt timestamp
   //   let timestamp = '';
   //   try {
   //     if (doc.createdAt) {
   //       const date = new Date(doc.createdAt);
   //       if (!isNaN(date.getTime())) {
   //         timestamp = formatTimestamp(date.toISOString());
   //       }
   //     }
   //   } catch (error) {
   //     logger.warn('Invalid createdAt for channel:', doc.docId, doc.createdAt);
   //   }

   //   return {
   //     id: doc.docId,
   //     type: 'channel',
   //     title: scopeType === 'DEFAULT' ? `#${channelName}` : channelName,
   //     subtitle: doc.description || doc.topic || `${doc.memberCount || 0} members`,
   //     context: doc.description || doc.topic || '',
   //     relevanceScore: hit.relevance,
   //     metadata: {
   //       timestamp: timestamp || 'N/A',
   //       channelName: channelName,
   //     },
   //     searchContext: {
   //       channelId: doc.docId,
   //       channelTitle: channelName,
   //       scopeType: scopeType,
   //     },
   //   };
   // }

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
     VespaFileDocument,
     VespaMailDocument
   } from '@/vespa/src/types';
   import { logger } from '@/utils/logger';
   
   // Frontend-compatible result type (matches DisplaySearchResult from dashboard/src/types/search.ts)
   
   
   export interface TransformedSearchResult {
     id: string;
     type: 'user' | 'conversation' | 'channel' | 'ticket' | 'attachment' | 'collection';
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
       callType?: string;
       mailId?: string;
       recipientCount?: number;
       // Knowledge base / collection specific fields
    projectId?: string;
    collectionId?: string;
    collectionName?: string;
    docId?: string;
    docName?: string;
    folderId?: string;
    pageNumber?: number;
    chunkContent?: string;
    chunkIndex?: number;
    slideUrl?: string;
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

   interface MailLinkInfo {
     emailId: string;          // Postgres email.id
     conversationId: string;   // Postgres conversation id
     ticketId?: string;        // Postgres ticket id (if ticket exists for the conv)
     ticketXyneId?: string;    // URL-friendly ticket id
     channelId?: string;
   }
   interface MailMap {
     [externalMessageId: string]: MailLinkInfo;
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
   
     // Collect all user IDs, channel IDs, and collection IDs we need to fetch
     const userIdsToFetch = new Set<string>();
     const channelIdsToFetch = new Set<string>();
     const mailDocIds = new Set<string>();
     const collectionIdsToFetch = new Set<string>();

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
   
    // For collection documents, collect collectionId to fetch projectId
    if (docType === 'file' && (doc as any).subApp === 'collections' && (doc as any).clId) {
      collectionIdsToFetch.add((doc as any).clId as string);
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
   
       // For mail docs, collect docIds (== Postgres email.id) so we can
       // batch-resolve the email → conversation → ticket mapping needed for
       // click-through navigation into the Desk view.
       if (docType === 'mail' && 'docId' in doc && doc.docId) {
         mailDocIds.add(doc.docId as string);
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
   
  // Batch fetch collection data (projectId) for collection documents
  const collectionProjectMap: Record<string, string> = {};
  if (collectionIdsToFetch.size > 0) {
    const collections: { id: string; projectId: string }[] = await (prisma as any).collection.findMany({
      where: {
        id: {
          in: Array.from(collectionIdsToFetch),
        },
      },
      select: {
        id: true,
        projectId: true,
      },
    });

    collections.forEach((collection) => {
      collectionProjectMap[collection.id] = collection.projectId;
    });
  }
     // Batch fetch mail → conversation → ticket mapping for Desk click-through.
     // Vespa stores the Postgres email.id directly as docId (see
     // ingest-mail-sample.ts), so we look up by id and the join is trivial.
     const mailMap: MailMap = {};
     if (mailDocIds.size > 0) {
       const emails = await prisma.email.findMany({
         where: { id: { in: Array.from(mailDocIds) } },
         select: { id: true, conversationId: true },
       });

       const conversationIds = Array.from(new Set(emails.map(e => e.conversationId)));
       const tickets = conversationIds.length > 0
         ? await prisma.ticket.findMany({
             where: { conversationId: { in: conversationIds } },
             select: { id: true, xyneId: true, conversationId: true, channelId: true },
           })
         : [];
       const ticketByConv = new Map(tickets.map(t => [t.conversationId, t]));

       for (const e of emails) {
         const t = ticketByConv.get(e.conversationId);
         mailMap[e.id] = {
           emailId: e.id,
           conversationId: e.conversationId,
           ticketId: t?.id,
           ticketXyneId: t?.xyneId,
           channelId: t?.channelId,
         };
       }
     }
     // Transform each hit
     return hits.map((hit) => transformSingleHit(hit, userMap, collectionProjectMap, mailMap));
   }
   
   /**
    * Transform a single Vespa hit to frontend format
    */
   function transformSingleHit(
     hit: VespaSearchHit,
     userMap: UserMap,
     collectionProjectMap: Record<string, string>,
     mailMap: MailMap,
): TransformedSearchResult {
     const doc = hit.fields;
     const docType = doc.docType as string;
   
   
     const debugInfo = ('matchfeatures' in doc || 'rankfeatures' in doc) ? {
       matchfeatures: 'matchfeatures' in doc ? doc.matchfeatures : undefined,
       rankfeatures: 'rankfeatures' in doc ? doc.rankfeatures : undefined,
       prefixBoost: '_prefixBoost' in doc ? doc._prefixBoost as number:undefined,
       originalScore: '_originalScore' in doc ? doc._originalScore as number:undefined,
     } : undefined;
   
     // Map schema names to handlers
     // Vespa returns schema names like 'chat_message', not enum values like 'message'
     let result: TransformedSearchResult;
     
     switch (docType) {
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
         // Check if this is a collection document by subApp field
      if ((doc as any).subApp === 'collections') {
        result = transformCollection(hit, doc as unknown as VespaFileDocument, collectionProjectMap);
      } else {
        result = transformFile(hit, doc as unknown as VespaFileDocument & Partial<importedChannelFields>);
         }
      break;
   
       case 'ticket':
         result = transformTicket(hit, doc as VespaTicketDocument & importedTicketFields, userMap);
         break;

       case 'mail':
         result = transformMail(hit, doc as VespaMailDocument, mailMap);
         break;

       // case 'channel':
       // case 'chat_container':
       //   result = transformChannel(hit, doc as VespaChatContainerDocument, userMap);
       //   break;

       default:
         // Fallback for unknown types - log for debugging
         logger.warn(`Unknown docType encountered: ${docType}`, { hitId: hit.id });
         result = {
           id: hit.id,
           type: 'conversation',
           title: 'Unknown Document',
           subtitle: `Type: ${docType}`,
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
    * Transform file document (non-collection files)
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
         callType: doc.callType,
       },
     };
   }
   
/**
 * Transform collection document (knowledge base file)
 */
function transformCollection(
  hit: VespaSearchHit,
  doc: VespaFileDocument,
  collectionProjectMap: Record<string, string>,
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
    logger.warn('Invalid createdAt for collection:', doc.docId, doc.createdAt);
  }

  // Extract collection ID and document name
  const collectionId = doc.clId;
  const docName = doc.fileName;

  // Find the best matching chunk using chunk_scores from Vespa matchfeatures
  const chunkScores = (hit.fields as any)?.matchfeatures?.chunk_scores;
  let chunkIndex = 0;

  if (chunkScores?.cells && typeof chunkScores.cells === 'object') {
    let maxScore = -Infinity;
    for (const [idx, score] of Object.entries(chunkScores.cells)) {
      if (typeof score === 'number' && score > maxScore) {
        maxScore = score;
        chunkIndex = parseInt(idx, 10);
      }
    }
  }

  // Clamp to valid range
  if (!doc.chunks || chunkIndex >= doc.chunks.length) {
    chunkIndex = 0;
  }

  const chunkContent = doc.chunks?.[chunkIndex] || '';
  const pageNumber = doc.chunks_pos?.[chunkIndex] ? parseInt(doc.chunks_pos[chunkIndex], 10) : undefined;
  const slideUrl = doc.slideUrl?.[chunkIndex] || undefined;

  // Parse metadata for collection name if available
  let collectionName: string | undefined;
  try {
    if (doc.metadata) {
      const metadata = JSON.parse(doc.metadata);
      collectionName = metadata.collectionName;
    }
  } catch (error) {
    logger.warn('Failed to parse metadata for collection:', doc.docId);
  }

  return {
    id: doc.docId,
    type: 'collection',
    title: docName || 'Unknown Document',
    subtitle: collectionName || 'Unknown Collection',
    context: chunkContent || doc.description || '',
    relevanceScore: hit.relevance,
    avatar: doc.ownerId,
    metadata: {
      timestamp: timestamp || 'N/A',
    },
    searchContext: {
      projectId: collectionId ? collectionProjectMap[collectionId] : undefined,
      collectionId,
      collectionName,
      docId: doc.docId,
      docName,
      folderId: doc.clFd || undefined,
      pageNumber,
      chunkContent,
      chunkIndex,
      slideUrl,
      internalUrl: `/collections/items/${doc.docId}/download`,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
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
   
   /**
    * Transform mail (Gmail) document
    */
   function transformMail(
     hit: VespaSearchHit,
     doc: VespaMailDocument,
     mailMap: MailMap,
   ): TransformedSearchResult {
     // Pick the first chunk that contains a <hi>...</hi> bolding span (the chunk
     // Vespa actually matched on). Fall back to the first chunk. Do NOT substring
     // the string — it could cut a <hi> tag in half; the dashboard's
     // SearchSnippetRenderer will pick a smart window around the highlights.
     let previewChunk = '';
     if (doc.chunks && doc.chunks.length > 0) {
       previewChunk = doc.chunks.find((c) => typeof c === 'string' && c.includes('<hi>')) || doc.chunks[0];
     }
     const sentAt = doc.timestamp ? new Date(doc.timestamp).toISOString() : new Date().toISOString();

     // Extract the sender's display name from a Gmail-style "Name <email>" string.
     // Falls back to the raw string when no angle-bracket block is present.
     const rawFrom = doc.from || '';
     const nameMatch = rawFrom.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
     const senderName = (nameMatch?.[1]?.trim() || rawFrom).replace(/^"|"$/g, '');

     const recipientCount =
       (doc.to?.length ?? 0) + (doc.cc?.length ?? 0) + (doc.bcc?.length ?? 0);

     const link = mailMap[doc.docId];

     return {
       id: hit.id,
       type: 'conversation',
       title: doc.subject || '(no subject)',
       subtitle: senderName,
       context: previewChunk,
       relevanceScore: hit.relevance,
       metadata: {
         timestamp: formatTimestamp(sentAt),
         channelName: 'Desk',
       },
       searchContext: {
         messageId: doc.docId,
         mailId: link?.emailId ?? doc.docId,
         conversationId: link?.conversationId,
         ticketId: link?.ticketId,
         xyneId: link?.ticketXyneId,
         channelId: link?.channelId,
         channelTitle: 'Desk',
         senderName,
         recipientCount,
         subApp: 'DESK',
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

   
import { PrismaClient } from '@prisma/client';
   import {
     VespaSearchHit,
     VespaChatMessageDocument,
     VespaTicketDocument,
     VespaChatContainerDocument,
     VespaUserDocument,
     importedChannelFields,
     User,
     Channel,
     importedTicketFields,
     VespaFileDocument,
     VespaMailDocument,
     VespaCallDocument
   } from '@/vespa/src/types';
   import { logger } from '@/utils/logger';
   
   // Frontend-compatible result type (matches DisplaySearchResult from dashboard/src/types/search.ts)
   
   
   export interface TransformedSearchResult {
     id: string;
     type: 'user' | 'conversation' | 'channel' | 'ticket' | 'attachment' | 'collection' | 'call';
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
       isRootMessage?: boolean;
       msgType?: string;
       threadSenders?: string[];
       attachmentIds?: string[];
       senderId?: string;
       senderName?: string;
       senderEmail?: string;
       userId?: string;
       email?: string;
       status?: string;
       memberCount?: number;
       closedBy?: string;
       closedByName?: string;
       boardName?: string;
       projectName?: string;
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
       formFieldMatches?: Array<{ fieldId: string; fieldName?: string; fieldValue: string }>;
       priority?: string;
       stageName?: string;
       projectId?: string;
       createdAtTimestamp?: number;
       updatedAtTimestamp?: number;
       ticketType?: string;
       userGroupId?: string;
       tags?: string[];
       callId?: string;
       externalId?: string;
       userIds?: string[];
       participantResponses?: string[];
       participantNames?: string[];
       participantEmails?: string[];
       title?: string;
       createdByUserId?: string;
       roomLink?: string;
       callOrigin?: string;
       startsAt?: number;
       endsAt?: number;
       startedAt?: number;
       endedAt?: number;
       recurringSeriesId?: string;
       hasTranscript?: boolean;
       // Knowledge base / collection specific fields
    collectionId?: string;
    docId?: string;
    folderId?: string;
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
     includeDebugInfo = false,
   ): Promise<TransformedSearchResult[]> {
     if (!hits || hits.length === 0) {
       return [];
     }
   
     // Collect all user IDs, channel IDs, and collection IDs we need to fetch
     const userIdsToFetch = new Set<string>();
     const channelIdsToFetch = new Set<string>();
     const mailDocIds = new Set<string>();
     const collectionIdsToFetch = new Set<string>();
     const formFieldIdsToFetch = new Set<string>();

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
    if (docType === 'file' && (doc as VespaFileDocument).subApp === 'collections' && (doc as VespaFileDocument).clId) {
      collectionIdsToFetch.add((doc as VespaFileDocument).clId as string);
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
         const mailDoc = doc as VespaMailDocument;
         mailDoc.ticketFormFields?.forEach(field => formFieldIdsToFetch.add(field.fieldId));
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
   
  // Batch fetch collection data (scopeType + scopeId) for collection documents
  // Then resolve projectId from channel when scopeType === 'CHANNEL'
  const collectionProjectMap: Record<string, { projectId: string; channelId: string }> = {};
  if (collectionIdsToFetch.size > 0) {
    const collections: { id: string; scopeType: string; scopeId: string }[] = await prisma.collection.findMany({
      where: {
        id: {
          in: Array.from(collectionIdsToFetch),
        },
      },
      select: {
        id: true,
        scopeType: true,
        scopeId: true,
      },
    });

    // Resolve projectId for CHANNEL-scoped collections
    const channelScopeIds = collections
      .filter(c => c.scopeType === 'CHANNEL')
      .map(c => c.scopeId);

    if (channelScopeIds.length > 0) {
      const scopeChannels: { id: string; projectId: string }[] = await prisma.channel.findMany({
        where: { id: { in: channelScopeIds } },
        select: { id: true, projectId: true },
      });
      const channelProjectMap: Record<string, string> = {};
      scopeChannels.forEach(ch => { channelProjectMap[ch.id] = ch.projectId; });

      collections.forEach(collection => {
        if (collection.scopeType === 'CHANNEL') {
          const projectId = channelProjectMap[collection.scopeId] ?? '';
          collectionProjectMap[collection.id] = { projectId, channelId: collection.scopeId };
        }
      });
    }
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

     // Resolve the stable Vespa field IDs to user-facing form labels in one query.
     // Legacy values use form_fields.id; new-style values use globalFieldId.
     const formFieldNameMap: Record<string, string> = {};
     if (formFieldIdsToFetch.size > 0) {
       const ids = Array.from(formFieldIdsToFetch);
       const fields = await prisma.formFields.findMany({
         where: {
           OR: [
             { id: { in: ids } },
             { globalFieldId: { in: ids } },
           ],
         },
         select: {
           id: true,
           fieldName: true,
           globalFieldId: true,
           globalField: { select: { fieldName: true } },
         },
       });
       for (const field of fields) {
         const fieldName = field.globalField?.fieldName ?? field.fieldName;
         if (!fieldName) continue;
         formFieldNameMap[field.id] = fieldName;
         if (field.globalFieldId) formFieldNameMap[field.globalFieldId] = fieldName;
       }
     }
     // Transform each hit
     return hits.map((hit) =>
       transformSingleHit(
         hit,
         userMap,
         collectionProjectMap,
         mailMap,
         formFieldNameMap,
         includeDebugInfo,
       ),
     );
   }
   
   /**
    * Transform a single Vespa hit to frontend format
    */
   function transformSingleHit(
     hit: VespaSearchHit,
     userMap: UserMap,
     collectionProjectMap: Record<string, { projectId: string; channelId: string }>,
     mailMap: MailMap,
     formFieldNameMap: Record<string, string>,
     includeDebugInfo = false,
   ): TransformedSearchResult {
     const doc = hit.fields;
     const docType = doc.docType as string;


     const debugInfo = includeDebugInfo && ('matchfeatures' in doc || 'rankfeatures' in doc) ? {
       matchfeatures: 'matchfeatures' in doc ? doc.matchfeatures : undefined,
       rankfeatures: 'rankfeatures' in doc ? doc.rankfeatures : undefined,
       prefixBoost: '_prefixBoost' in doc ? doc._prefixBoost as number:undefined,
       originalScore: '_originalScore' in doc ? doc._originalScore as number:undefined,
     } : undefined;
   
     // Map schema names to handlers
     // Vespa returns schema names like 'chat_message', not enum values like 'message'
     let result: TransformedSearchResult;
     
     switch (docType) {
   
       case 'message':
         result = transformMessage(hit, doc as VespaChatMessageDocument & importedChannelFields);
         break;
       
   
      case 'file':
         // Check if this is a collection document by subApp field
      if ((doc as VespaFileDocument).subApp === 'collections') {
        result = transformCollection(hit, doc as unknown as VespaFileDocument, collectionProjectMap);
      } else {
        result = transformFile(hit, doc as unknown as VespaFileDocument & Partial<importedChannelFields>);
         }
      break;
   
       case 'ticket':
         result = transformTicket(hit, doc as VespaTicketDocument & importedTicketFields, userMap);
         break;

       case 'mail':
         result = transformMail(hit, doc as VespaMailDocument, mailMap, formFieldNameMap);
         break;

       case 'call':
         result = transformCall(hit, doc as VespaCallDocument);
         break;

       case 'user':
         result = transformUser(hit, doc as unknown as VespaUserDocument);
         break;

       case 'channel':
       case 'chat_container':
         result = transformChannel(hit, doc as unknown as VespaChatContainerDocument);
         break;


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
   
   /**
    * Transform user document
    */
   
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
         isRootMessage: doc.isRootMessage ?? false,
         msgType: doc.messageType,
         createdAtTimestamp: doc.createdAtTimestamp,
         threadSenders: doc.threadSenders,
         attachmentIds: doc.attachmentIds,
         senderId: doc.userId,
         senderName: doc.username,
         senderEmail: doc.userEmail,
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

     // The body the hit actually matched on. Vespa ranks `file` docs over their
     // `chunks` (for subApp=TRANSCRIPT those chunks ARE the call transcript), so
     // echoing fileName here made every content match come back with no content
     // — callers could see THAT a transcript matched but never WHAT was said.
     const chunkContent = pickBestChunk(hit, doc);

     // TRANSCRIPT docs are keyed by the internal call id, but the call APIs
     // (…/download-transcript, recording detail) are keyed by externalId, which
     // only exists inside the doc's metadata JSON. Surface both so a caller can
     // go from a search hit to the full transcript without a second lookup.
     let callId: string | undefined;
     let externalId: string | undefined;
     if (doc.subApp?.toUpperCase() === 'TRANSCRIPT' && doc.metadata) {
       try {
         const parsed = JSON.parse(doc.metadata) as { callId?: string; externalId?: string };
         callId = parsed.callId;
         externalId = parsed.externalId;
       } catch (error) {
         logger.warn('Failed to parse metadata for transcript:', doc.docId);
       }
     }

     return {
       id: doc.docId,
       type: 'attachment',
       title: doc.fileName,
       subtitle: doc.description,
       context: chunkContent || doc.description || doc.fileName,
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
         fileSize: doc.fileSize,
         mimeType: doc.mimeType,
         ...(callId ? { callId } : {}),
         ...(externalId ? { externalId } : {}),
       },
     };
   }
   
/**
 * Pick the chunk a `file` hit actually matched on.
 *
 * Vespa's `chunk_scores` match-feature is the authoritative signal, but it is
 * only present when the deployed rank profile publishes it. Fall back to the
 * chunk carrying the most `<hi>` highlights (the same heuristic transformMail
 * uses), then to the first chunk. Never substring the result — that could cut a
 * `<hi>` tag in half; the dashboard's SearchSnippetRenderer windows it instead.
 */
function pickBestChunk(hit: VespaSearchHit, doc: VespaFileDocument): string {
  const chunks = doc.chunks;
  if (!chunks || chunks.length === 0) return '';

  const chunkScores = (hit.fields as any)?.matchfeatures?.chunk_scores;
  if (chunkScores?.cells && typeof chunkScores.cells === 'object') {
    let maxScore = -Infinity;
    let bestIndex = 0;
    for (const [idx, score] of Object.entries(chunkScores.cells)) {
      if (typeof score === 'number' && score > maxScore) {
        maxScore = score;
        bestIndex = parseInt(idx, 10);
      }
    }
    if (bestIndex >= 0 && bestIndex < chunks.length) return chunks[bestIndex] || '';
  }

  let best = '';
  let bestCount = 0;
  for (const c of chunks) {
    if (typeof c !== 'string') continue;
    const count = (c.match(/<hi>/g) || []).length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best || chunks[0] || '';
}

/**
 * Transform collection document (knowledge base file)
 */
function transformCollection(
  hit: VespaSearchHit,
  doc: VespaFileDocument,
  collectionProjectMap: Record<string, { projectId: string; channelId: string }>,
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

  const scopeEntry = collectionId ? collectionProjectMap[collectionId] : undefined;

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
      projectId: scopeEntry?.projectId,
      channelId: scopeEntry?.channelId,
      collectionId,
      docId: doc.docId,
      folderId: doc.clFd || undefined,
      internalUrl: `/collections/items/${doc.docId}/download`,
    },
  };
}

   function transformCall(
     hit: VespaSearchHit,
     doc: VespaCallDocument,
   ): TransformedSearchResult {
     return {
       id: doc.callId || doc.docId,
       type: 'call',
       title: doc.title || 'Untitled Call',
       subtitle: doc.channelName || 'Call',
       context: [...(doc.participantNames || []), ...(doc.participantEmails || [])]
         .filter(Boolean)
         .join(' '),
       relevanceScore: hit.relevance,
       metadata: {
         timestamp: String(
           doc.startsAtTimestamp || doc.startedAtTimestamp || doc.endedAtTimestamp || 0,
         ),
         channelName: doc.channelName,
       },
       searchContext: {
         callId: doc.callId,
         externalId: doc.externalId,
         callType: doc.callType,
         channelId: doc.channelId,
         channelTitle: doc.channelName,
         userIds: doc.userIds,
         participantResponses: doc.participantResponses,
         title: doc.title,
         createdByUserId: doc.createdByUserId,
         roomLink: doc.roomLink,
         callOrigin: doc.callOrigin,
         status: doc.status,
         startsAt: doc.startsAtTimestamp,
         endsAt: doc.endsAtTimestamp,
         startedAt: doc.startedAtTimestamp,
         endedAt: doc.endedAtTimestamp,
         recurringSeriesId: doc.recurringSeriesId,
         hasTranscript: doc.hasTranscript,
         participantNames: doc.participantNames,
         participantEmails: doc.participantEmails,
         docId: doc.docId,
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
     let updatedAtTimestamp: number | undefined;
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
     try {
       if (doc.updatedAt) {
         const date = new Date(doc.updatedAt);
         if (!isNaN(date.getTime())) {
           updatedAtTimestamp = date.getTime();
         }
       }
     } catch (error) {
       logger.warn('Invalid updatedAt for ticket:', doc.docId, doc.updatedAt);
     }
   
     // Get creator and assignee names from userMap
     const creator = userMap[doc.createdBy];
     const creatorName = creator?.name || creator?.email || 'Unknown Creator';
     
     const assignee = doc.assignedTo ? userMap[doc.assignedTo] : null;
     const assigneeName = assignee?.name || assignee?.email || null;
   
      // Strip <hi> tags from xyneId for navigation/URLs — keep the original (with tags)
      // for subtitle display so the UI can render query-match highlights.
      const xyneIdPlain = doc.xyneId?.replace(/<\/?hi>/gi, '') ?? doc.xyneId;

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
         // Vespa denormalizes the channel name onto the ticket doc; surfacing it
         // lets formatSearchResult print "#channel" for ticket hits.
         channelName: doc.channelName,
       },
       searchContext: {
         ticketId: doc.docId,
         ticketStatus: doc.status,
         channelId: doc.channelId,
         boardId: doc.boardId,
         boardName: doc.boardName,
         createdBy: doc.createdBy,
         creatorName: creatorName !== 'Unknown Creator' ? creatorName : (doc.createdByName || creatorName),
         assignedTo: doc.assignedTo,
         assigneeName: assigneeName || doc.assignedToName || undefined,
         closedBy: doc.closedBy,
         closedByName: doc.closedByName || undefined,
         conversationId: doc.convId,
         xyneId: xyneIdPlain,
         priority: doc.priority,
         stageName: doc.stage,
         projectId: doc.projectRef,
         projectName: doc.projectName,
         createdAtTimestamp: doc.createdAtTimestamp,
         updatedAtTimestamp,
         ticketType: doc.ticketType,
         userGroupId: doc.userGroupId,
         tags: doc.tags,
         replyCount: doc.replyCount || 0,
         threadSenders: doc.threadSenders,
         attachmentIds: doc.attachmentIds,
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
     formFieldNameMap: Record<string, string>,
   ): TransformedSearchResult {
     // Pick the chunk with the densest <hi>...</hi> highlights (the chunk most
     // relevant to the query). Fall back to the first chunk. Do NOT substring
     // the string — it could cut a <hi> tag in half; the dashboard's
     // SearchSnippetRenderer will pick a smart window around the highlights.
     let previewChunk = '';
     if (doc.chunks && doc.chunks.length > 0) {
       let bestCount = 0;
       for (const c of doc.chunks) {
         if (typeof c !== 'string') continue;
         const count = (c.match(/<hi>/g) || []).length;
         if (count > bestCount) {
           bestCount = count;
           previewChunk = c;
         }
       }
       if (!previewChunk) previewChunk = doc.chunks[0];
     }
     const sentAt = doc.timestamp ? new Date(doc.timestamp).toISOString() : new Date().toISOString();

     // Extract the sender's display name from a Gmail-style "Name <email>" string.
     // Falls back to the raw string when no angle-bracket block is present.
     const rawFrom = doc.from || '';
     const nameMatch = rawFrom.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
     const senderName = (nameMatch?.[1]?.trim() || rawFrom).replace(/^"|"$/g, '');
     const emailMatch = rawFrom.match(/<([^>]+)>/);
     const senderEmail = (emailMatch?.[1] || (rawFrom.includes('@') ? rawFrom.trim() : '')).trim() || undefined;

     const recipientCount =
       (doc.to?.length ?? 0) + (doc.cc?.length ?? 0) + (doc.bcc?.length ?? 0);

     const link = mailMap[doc.docId];
     // Match ticket rendering: keep Vespa's potentially highlighted ID in the
     // display subtitle, but strip tags from the routing value.
     const xyneIdPlain = (link?.ticketXyneId ?? doc.xyneId)?.replace(/<\/?hi>/gi, '');
     const formFieldMatches = getVespaHighlightedFormFields(
       doc.ticketFormFields,
       doc.ticketFormFieldValues,
       formFieldNameMap,
     );

     return {
       id: hit.id,
       type: 'conversation',
       title: doc.subject || '(no subject)',
       subtitle: doc.xyneId || xyneIdPlain || '',
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
         xyneId: xyneIdPlain,
         channelId: link?.channelId,
         channelTitle: 'Desk',
         senderName,
         senderEmail,
         recipientCount,
         ...(formFieldMatches.length > 0 && { formFieldMatches }),
         subApp: 'DESK',
       },
     };
   }

   function getVespaHighlightedFormFields(
     formFields: VespaMailDocument['ticketFormFields'],
     highlightedValues: VespaMailDocument['ticketFormFieldValues'],
     formFieldNameMap: Record<string, string>,
   ): Array<{ fieldId: string; fieldName?: string; fieldValue: string }> {
     if (!formFields?.length || !highlightedValues?.length) return [];

     const highlightedByValue = new Map<string, string>();
     for (const value of highlightedValues) {
       if (!/<hi>.*?<\/hi>/i.test(value)) continue;
       highlightedByValue.set(value.replace(/<\/?hi>/gi, ''), value);
     }

     return formFields.flatMap(field => {
       const highlighted = highlightedByValue.get(field.fieldValue);
       if (!highlighted) return [];

       return [{
         fieldId: field.fieldId,
         fieldName: formFieldNameMap[field.fieldId],
         fieldValue: highlighted,
       }];
     });
   }

   /**
    * Transform user (people-directory) document. Without this case, user hits
    * fell to the default branch and rendered as "Unknown Document — Type: user"
    * with the raw record JSON-dumped into the snippet.
    */
   function transformUser(
     hit: VespaSearchHit,
     doc: VespaUserDocument & { docId: string },
   ): TransformedSearchResult {
     let timestamp = '';
     try {
       if (doc.createdAt) {
         const date = new Date(doc.createdAt);
         if (!isNaN(date.getTime())) timestamp = formatTimestamp(date.toISOString());
       }
     } catch { /* leave blank */ }
     return {
       id: doc.docId,
       type: 'user',
       title: doc.name || doc.email || 'Unknown User',
       subtitle: doc.email || '',
       context: doc.orgName || '',
       relevanceScore: hit.relevance,
       avatar: doc.photoLink || doc.docId,
       metadata: {
         timestamp: timestamp || 'N/A',
         status: doc.status ? String(doc.status) : undefined,
       },
       searchContext: {
         userId: doc.docId,
         // Also expose as senderId so the agent can drop it straight into
         // spaces-search from=<id> or a spaces-messages sender filter.
         senderId: doc.docId,
         email: doc.email,
         status: doc.status ? String(doc.status) : undefined,
         createdAtTimestamp: doc.createdAt,
       },
     };
   }

   /**
    * Transform channel (chat_container) document. Same class of fix as
    * transformUser — channel hits also fell to the JSON-dump default.
    */
   function transformChannel(
     hit: VespaSearchHit,
     doc: VespaChatContainerDocument & { docId: string },
   ): TransformedSearchResult {
     let timestamp = '';
     try {
       if (doc.createdAt) {
         const date = new Date(doc.createdAt);
         if (!isNaN(date.getTime())) timestamp = formatTimestamp(date.toISOString());
       }
     } catch { /* leave blank */ }
     return {
       id: doc.docId,
       type: 'channel',
       title: `#${doc.channelName || 'Unknown Channel'}`,
       subtitle: doc.description || doc.topic || '',
       context: doc.description || doc.topic || '',
       relevanceScore: hit.relevance,
       metadata: {
         timestamp: timestamp || 'N/A',
         channelName: doc.channelName,
       },
       searchContext: {
         channelId: doc.docId,
         channelTitle: doc.channelName,
         scopeType: doc.scopeType,
         memberCount: doc.memberCount,
       },
     };
   }

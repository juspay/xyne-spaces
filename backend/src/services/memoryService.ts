import { logger } from '@/utils/logger';
import { vespaClient } from '@/services/vespaSearch';
import { NAMESPACE, CLUSTER } from '@/vespa/vespaConfig';
import {
  VespaSearchResponse,
  MemoryUpdateFields,
  MemorySearchRequest,
  VespaMemoryDocument,
  MemorySearchResult,
  memorySchema,
  MemoryScope,
  VespaDocType,
  VespaSearchHit,
  VespaSchema,
} from '@/vespa/src/types';
import { User } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import removeMarkdown from 'remove-markdown';

const MEMORY_SCHEMA = memorySchema;

/**
 * Strip markdown syntax to produce clean plain text
 */
function stripMarkdown(md: string): string {
  if (!md) return '';
  return removeMarkdown(md);
}
const MAX_CHUNK_SIZE = 5000;
export function chunkContent(content: string): string[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return [content];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    let end = start + MAX_CHUNK_SIZE;
    
    // Try to break at a newline if possible
    if (end < content.length) {
      const lastNewline = content.lastIndexOf('\n', end);
      if (lastNewline > start) {
        end = lastNewline + 1;
      }
    }
    
    chunks.push(content.substring(start, end));
    start = end;
  }

  return chunks;
}

/**
 * Build YQL query for memory search
 */
async function buildMemoryYql(params: {
  query?: string;
  scope: MemoryScope;
  userId: string;
  limit: number;
  offset: number;
  docType?: VespaDocType;
  tags?: string[];
  repoUrl?: string;
  commitId?: string;
  sessionId?: string;
  filePointers?: string;
  ticketId?: string;
  parentRef?: string;
  reviewStatus?: string;
  docId?: string;
}): Promise<string> {
  const { query, scope, userId, limit, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus, docId } = params;

  const conditions: string[] = [];

  // get the email of that user
  const prisma = DatabaseClient.getInstance();
  const user: User | null = await prisma.user.findUnique({
    where: { id: userId },
  });

  // Scope filter: 'my' restricts to user's own documents
  if (scope === 'my') {
    conditions.push(`userId contains "${user?.email}"`);
  }

  // DocType filter
  if (docType) {
    conditions.push(`docType contains "${docType}"`);
  }

  // DocId filter
  if (docId) {
    conditions.push(`docId contains "${docId}`);
  }

  // Tags filter
  if (tags && tags.length > 0) {
    const tagConditions = tags.map((tag) => `tags contains "${tag}"`);
    conditions.push(`(${tagConditions.join(' or ')})`);
  }

  // RepoUrl filter
  if (repoUrl) {
    conditions.push(`repoUrl contains "${repoUrl}"`);
  }

  // CommitId filter (exact match)
  if (commitId) {
    conditions.push(`commitId contains "${commitId}"`);
  }

  // SessionId filter (exact match)
  if (sessionId) {
    conditions.push(`sessionId contains "${sessionId}"`);
  }

  // FilePointers filter
  if (filePointers) {
    conditions.push(`filePointers contains "${filePointers}"`);
  }

  // TicketId filter
  if (ticketId) {
    conditions.push(`ticketId contains "${ticketId}"`);
  }

  // ParentRef filter (exact match)
  if (parentRef) {
    conditions.push(`parentRef contains "${parentRef}"`);
  }

  // ReviewStatus filter
  if (reviewStatus) {
    conditions.push(`reviewStatus contains "${reviewStatus}"`);
  }

  // Search condition (text + vector)
  if (query && query.trim()) {
    conditions.push(
      `(userInput(@query) or ({targetHits:${limit}} nearestNeighbor(summary_embeddings, e)))`,
    );
  }

  const whereClause = conditions.length > 0 ? ` where ${conditions.join(' and ')}` : ` where true`;

  return `select * from sources ${MEMORY_SCHEMA}${whereClause}`;
}

/**
 * Transform Vespa search hits into MemoryDocument array
 */
function transformMemoryHits(
  hits: VespaSearchHit[],
  scope: MemoryScope,
): VespaMemoryDocument[] {
  return hits.map((hit) => {
    const fields = (hit.fields || {}) as VespaMemoryDocument;

    const doc: VespaMemoryDocument = {
      docId: fields.docId,
      docType: fields.docType,
      userId: '',
      sessionId: fields.sessionId,
      repoUrl: fields.repoUrl,
      commitId: fields.commitId,
      ticketId: fields.ticketId,
      userQuery: fields.userQuery,
      tags: fields.tags,
      filePointers: fields.filePointers,
      chatSummary: fields.chatSummary,
      rawContent: fields.rawContent,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
      committedAt: fields.committedAt,
      agentUsed: fields.agentUsed,
      modelUsed: fields.modelUsed,
      parentRef: fields.parentRef,
      reviewStatus: fields.reviewStatus,
      relevanceScore: hit.relevance,
    };

    // Only include userId for 'my' scope (privacy)
    if (scope === MemoryScope.MY) {
      doc.userId = fields.userId;
    }

    return doc;
  });
}

/**
 * Search memory documents in Vespa
 */
export async function searchMemory(
  request: MemorySearchRequest,
  userId: string,
): Promise<MemorySearchResult> {
  const { query, scope, limit = 20, offset = 0, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus , includeQuery = true, includeSummary = true, docId} = request;

  const yql = await buildMemoryYql({
    query,
    scope,
    userId,
    limit,
    offset,
    docType,
    tags,
    repoUrl,
    commitId,
    sessionId,
    filePointers,
    ticketId,
    parentRef,
    reviewStatus,
    docId,
  });


  const payload: Record<string, any> = {
    yql,
    hits: limit,
    offset,
    'ranking.profile': 'default_native',
    timeout: '10s',
  };

  // Add query and embedding input only when query is present
  if (query && query.trim()) {
    payload.query = query;
    payload['input.query(e)'] = 'embed(@query)';
    payload['input.query(alpha)'] = 0.5;
    payload['input.query(includeSummary)'] = Number(includeSummary);
    payload['input.query(includeQuery)'] = Number(includeQuery);
    // Set fieldset based on flags
    if (includeSummary && includeQuery) {
      payload['model.defaultIndex'] = 'default';
    } else if (includeSummary && !includeQuery) {
      payload['model.defaultIndex'] = 'noUserQuery';
    } else if (!includeSummary && includeQuery) {
      payload['model.defaultIndex'] = 'noChatSummary';
    }
  }

  logger.info(`[Memory] Search payload: ${JSON.stringify(payload)}`);

  const response = await vespaClient.search<VespaSearchResponse>(payload);

  const hits = response.root?.children || [];
  const totalCount = response.root?.fields?.totalCount || 0;

  const documents = transformMemoryHits(hits, scope);

  return {
    documents,
    totalCount,
    hasMore: offset + limit < totalCount,
  };
}

/**
 * Get a single memory document by ID from Vespa
 */
export async function getMemoryById(
  docId: string,
): Promise<VespaMemoryDocument | null> {
  try {
    const result = await vespaClient.getDocument({
      namespace: NAMESPACE,
      cluster: CLUSTER,
      schema: MEMORY_SCHEMA as VespaSchema,
      docId,
    });

    if (!result || !result.fields) {
      return null;
    }

    const fields = result.fields as VespaMemoryDocument;
    return {
      docId: fields.docId,
      docType: fields.docType,
      userId: fields.userId,
      sessionId: fields.sessionId,
      repoUrl: fields.repoUrl,
      commitId: fields.commitId,
      ticketId: fields.ticketId,
      userQuery: fields.userQuery,
      tags: fields.tags,
      filePointers: fields.filePointers,
      chatSummary: fields.chatSummary,
      rawContent: fields.rawContent,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
      committedAt: fields.committedAt,
      agentUsed: fields.agentUsed,
      modelUsed: fields.modelUsed,
      parentRef: fields.parentRef,
      reviewStatus: fields.reviewStatus,
    };
  } catch (error) {
    logger.error(`[Memory] Error fetching document ${docId}:`, error);
    throw error;
  }
}

/**
 * Insert a memory document into Vespa
 */
export async function insertMemory(doc: VespaMemoryDocument): Promise<void> {
  await vespaClient.insert(doc as any, {
    namespace: NAMESPACE,
    cluster: CLUSTER,
    schema: MEMORY_SCHEMA as any,
  });
}

/**
 * Update a memory document in Vespa (partial update)
 */
export async function updateMemory(
  docId: string,
  fields: MemoryUpdateFields,
): Promise<VespaMemoryDocument | null> {
  try {
    const oldDoc = await getMemoryById(docId);
    if (!oldDoc) throw new Error(`Document ${docId} not found`);

    // If only reviewStatus is being updated, do an in-place update
    const fieldKeys = Object.keys(fields);
    if (
      fieldKeys.length === 1 &&
      fieldKeys[0] === 'reviewStatus' &&
      typeof fields.reviewStatus === 'string'
    ) {
      // In-place update (patch)
      await vespaClient.updateDocument(
        { reviewStatus: fields.reviewStatus },
        {
          namespace: NAMESPACE,
          cluster: CLUSTER,
          schema: MEMORY_SCHEMA as VespaSchema,
          docId,
        }
      );
      logger.info(`[Memory] In-place updated reviewStatus for document ${docId}`);
      return getMemoryById(docId);
    }

    // Otherwise, create a new versioned document
    // Use timestamp to ensure unique new docId
    const newDocId = `${oldDoc.docId}-${Date.now()}`;

    // If rawContent is being updated, auto-derive chatSummary
    if (fields.rawContent) {
      const cleanedContent = stripMarkdown(fields.rawContent);
      fields.chatSummary = chunkContent(cleanedContent);
    }

    const newDoc: VespaMemoryDocument = {
      ...oldDoc,
      ...fields,
      docId: newDocId,
      parentRef: oldDoc.docId,
      updatedAt: Date.now(),
      createdAt: oldDoc.createdAt,
    };

    await insertMemory(newDoc);

    logger.info(`[Memory] Created new version ${newDocId} for document ${docId}`);
    return getMemoryById(newDocId);
  } catch (error) {
    logger.error(`[Memory] Error updating document ${docId}:`, error);
    throw error;
  }
}

/**
 * Delete a memory document from Vespa
 */
export async function deleteMemory(docId: string): Promise<void> {
  try {
    await vespaClient.deleteDocument({
      namespace: NAMESPACE,
      cluster: CLUSTER,
      schema: MEMORY_SCHEMA as VespaSchema,
      docId,
    });

    logger.info(`[Memory] Deleted document ${docId}`);
  } catch (error) {
    logger.error(`[Memory] Error deleting document ${docId}:`, error);
    throw error;
  }
}

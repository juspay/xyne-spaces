import { logger } from '@/utils/logger';
import { VespaQueryParams } from '@/vespa/src/utils/YqlBuilder';
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
 * Passed as workspaceId by background ingestion paths whose job payload carries no workspace.
 * Every request-serving caller passes a real workspace id; this constant exists so the small
 * number of unscoped callers are greppable rather than implicit.
 */
export const ALL_WORKSPACES = '__all_workspaces__';

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
  workspaceId: string;
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
}): Promise<{ yql: string; params: VespaQueryParams }> {
  const { query, scope, userId, workspaceId, limit, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus, docId } = params;

  const conditions: string[] = [];
  const queryParams = new VespaQueryParams();

  // Escape any value interpolated into a YQL string literal: a raw `"` or `\` in a filter
  // value (a docId/tag/repoUrl, or an ingested value such as an email subject that lands in
  // these fields) would otherwise terminate the `"…"` literal and change the WHERE clause.
  // The free-text `query` is NOT interpolated: it is bound as the @query parameter
  // (userInput(@query)), so it stays parameterized.


  // Every memory query is scoped to the caller's workspace.
  if (workspaceId !== ALL_WORKSPACES) {
    conditions.push(`workspaceId contains ${queryParams.bind('workspaceId', workspaceId)}`);
  }

  // get the email of that user
  const prisma = DatabaseClient.getInstance();
  const user: User | null = await prisma.user.findUnique({
    where: { id: userId },
  });

  // Scope filter: 'my' restricts to user's own documents
  if (scope === 'my') {
    conditions.push(`userId contains ${queryParams.bind('userId', user?.email ?? '')}`);
  }

  // DocType filter
  if (docType) {
    conditions.push(`docType contains ${queryParams.bind('docType', docType)}`);
  }

  // DocId filter
  if (docId) {
    conditions.push(`docId contains ${queryParams.bind('docId', docId)}`);
  }

  // Tags filter
  if (tags && tags.length > 0) {
    const tagConditions = tags.map((tag) => `tags contains ${queryParams.bind('tags', tag)}`);
    conditions.push(`(${tagConditions.join(' or ')})`);
  }

  // RepoUrl filter
  if (repoUrl) {
    conditions.push(`repoUrl contains ${queryParams.bind('repoUrl', repoUrl)}`);
  }

  // CommitId filter (exact match)
  if (commitId) {
    conditions.push(`commitId contains ${queryParams.bind('commitId', commitId)}`);
  }

  // SessionId filter (exact match)
  if (sessionId) {
    conditions.push(`sessionId contains ${queryParams.bind('sessionId', sessionId)}`);
  }

  // FilePointers filter
  if (filePointers) {
    conditions.push(`filePointers contains ${queryParams.bind('filePointers', filePointers)}`);
  }

  // TicketId filter
  if (ticketId) {
    conditions.push(`ticketId contains ${queryParams.bind('ticketId', ticketId)}`);
  }

  // ParentRef filter (exact match)
  if (parentRef) {
    conditions.push(`parentRef contains ${queryParams.bind('parentRef', parentRef)}`);
  }

  // ReviewStatus filter
  if (reviewStatus) {
    conditions.push(`reviewStatus contains ${queryParams.bind('reviewStatus', reviewStatus)}`);
  }

  // Search condition (text + vector)
  if (query && query.trim()) {
    conditions.push(
      `(userInput(@query) or ({targetHits:${limit}} nearestNeighbor(summary_embeddings, e)))`,
    );
  }

  const whereClause = conditions.length > 0 ? ` where ${conditions.join(' and ')}` : ` where true`;

  return { yql: `select * from sources ${MEMORY_SCHEMA}${whereClause}`, params: queryParams };
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

async function attachPullRequestsToDocuments(
  documents: VespaMemoryDocument[],
  ticketId: string,
): Promise<void> {
  try {
    const prisma = DatabaseClient.getInstance();
    const pullRequests = await prisma.pullRequests.findMany({
      where: { ticketId },
      select: {
        prId: true,
        repoName: true,
        sourceBranchName: true,
        destinationBranchName: true,
        prUrl: true,
        status: true,
      },
    });
    if (pullRequests.length === 0) return;
    for (const doc of documents) {
      if (doc.ticketId === ticketId) {
        doc.pullRequests = pullRequests;
      }
    }
  } catch (prError) {
    logger.error('Error fetching pull requests for ticketId', {
      ticketId,
      error: prError instanceof Error ? prError.message : 'Unknown error',
    });
  }
}


export async function searchMemory(
  request: MemorySearchRequest,
  userId: string,
  workspaceId: string,
): Promise<MemorySearchResult> {
  const { query, scope, limit = 20, offset = 0, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus , includeQuery = true, includeSummary = true, docId} = request;

  const { yql, params } = await buildMemoryYql({
    query,
    scope,
    userId,
    workspaceId,
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
    ...params.toRequestProperties(),
  };

  // Add query and embedding input only when query is present
  if (query && query.trim()) {
    payload.query = query;
    payload['input.query(e)'] = 'embed(hf-embedder, @query)';
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

  if (ticketId) {
    await attachPullRequestsToDocuments(documents, ticketId);
  }

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
  workspaceId: string,
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

    // A document from another workspace is treated as absent.
    const docWorkspaceId = (result.fields as { workspaceId?: unknown }).workspaceId;
    if (workspaceId !== ALL_WORKSPACES && (typeof docWorkspaceId !== 'string' || docWorkspaceId !== workspaceId)) {
      logger.warn('[Memory] Document requested outside its workspace', { docId });
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
  workspaceId: string,
): Promise<VespaMemoryDocument | null> {
  try {
    const oldDoc = await getMemoryById(docId, workspaceId);
    if (!oldDoc) throw new Error(`Document ${docId} not found`);

    // If rawContent is being updated, auto-derive chatSummary from it
    if (fields.rawContent) {
      fields.chatSummary = chunkContent(stripMarkdown(fields.rawContent));
    }

    // In-place update for all provided fields
    await vespaClient.updateDocument(
      fields as Record<string, unknown>,
      {
        namespace: NAMESPACE,
        cluster: CLUSTER,
        schema: MEMORY_SCHEMA as VespaSchema,
        docId,
      }
    );

    logger.info(`[Memory] In-place updated document ${docId}`, { fields: Object.keys(fields) });
    return getMemoryById(docId, workspaceId);
  } catch (error) {
    logger.error(`[Memory] Error updating document ${docId}:`, error);
    throw error;
  }
}

/**
 * Delete a memory document from Vespa
 */
export async function deleteMemory(docId: string, workspaceId: string): Promise<void> {
  const existing = await getMemoryById(docId, workspaceId);
  if (!existing) {
    logger.warn('[Memory] Refusing delete outside the caller workspace', { docId });
    return;
  }
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

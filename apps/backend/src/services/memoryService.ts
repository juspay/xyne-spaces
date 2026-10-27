import { logger } from '@/utils/logger';
import { escapeYqlString } from '@/utils/yqlEscape';
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
import { DatabaseClient } from '@/database/client';
import removeMarkdown from 'remove-markdown';

const MEMORY_SCHEMA = memorySchema;

/**
 * Who a memory search runs for: a request user's id, or an internal caller that has already
 * resolved the workspace server-side. There is no unscoped search.
 */
export type MemoryCaller = string | { workspaceId: string };

/**
 * Resolve the workspace of a memory document owner (stored as the owner's email or id).
 */
export async function resolveMemoryWorkspaceId(owner: string): Promise<string> {
  const prisma = DatabaseClient.getInstance();
  const user = owner
    ? await prisma.user.findFirst({
        where: { OR: [{ email: owner }, { id: owner }] },
        select: { workspaceId: true },
      })
    : null;
  if (!user?.workspaceId) {
    throw new Error('Cannot determine workspace for memory document owner');
  }
  return user.workspaceId;
}

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
  caller: MemoryCaller;
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
  const { query, scope, caller, limit, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus, docId } = params;

  const conditions: string[] = [];

  // Escape any value interpolated into a YQL string literal: a raw `"` or `\` in a filter
  // value (a docId/tag/repoUrl, or an ingested value such as an email subject that lands in
  // these fields) would otherwise terminate the `"…"` literal and change the WHERE clause.
  // The free-text `query` is NOT interpolated: it is bound as the @query parameter
  // (userInput(@query)), so it stays parameterized.

  // The `contains` filters below select which of a user's cumulative memory a request is
  // about. `scope` chooses between the caller's own documents and the shared set.
  //
  // Any narrowing this clause needs to apply belongs here, alongside the scope filter, and
  // is bound through VespaQueryParams rather than interpolated — see YqlBuilder.

  // Every search is confined to one workspace, whatever the scope: without this, a doc
  // written by any workspace is returned to (and can poison) every other one. Fail closed
  // if the workspace cannot be resolved.
  let workspaceId: string | undefined;
  let email: string | undefined;
  if (typeof caller === 'string') {
    const prisma = DatabaseClient.getInstance();
    const user = caller
      ? await prisma.user.findUnique({
          where: { id: caller },
          select: { email: true, workspaceId: true },
        })
      : null;
    workspaceId = user?.workspaceId;
    email = user?.email;
  } else {
    workspaceId = caller.workspaceId;
  }
  if (!workspaceId) {
    throw new Error('Cannot determine workspace for memory search caller');
  }
  conditions.push(`workspaceId contains "${escapeYqlString(workspaceId)}"`);

  // Scope filter: 'my' further restricts to the user's own documents
  if (scope === 'my') {
    if (!email) {
      throw new Error("Memory scope 'my' requires a user");
    }
    conditions.push(`userId contains "${escapeYqlString(email)}"`);
  }

  // DocType filter
  if (docType) {
    conditions.push(`docType contains "${escapeYqlString(docType)}"`);
  }

  // DocId filter
  if (docId) {
    conditions.push(`docId contains "${escapeYqlString(docId)}"`);
  }

  // Tags filter
  if (tags && tags.length > 0) {
    const tagConditions = tags.map((tag) => `tags contains "${escapeYqlString(tag)}"`);
    conditions.push(`(${tagConditions.join(' or ')})`);
  }

  // RepoUrl filter
  if (repoUrl) {
    conditions.push(`repoUrl contains "${escapeYqlString(repoUrl)}"`);
  }

  // CommitId filter (exact match)
  if (commitId) {
    conditions.push(`commitId contains "${escapeYqlString(commitId)}"`);
  }

  // SessionId filter (exact match)
  if (sessionId) {
    conditions.push(`sessionId contains "${escapeYqlString(sessionId)}"`);
  }

  // FilePointers filter
  if (filePointers) {
    conditions.push(`filePointers contains "${escapeYqlString(filePointers)}"`);
  }

  // TicketId filter
  if (ticketId) {
    conditions.push(`ticketId contains "${escapeYqlString(ticketId)}"`);
  }

  // ParentRef filter (exact match)
  if (parentRef) {
    conditions.push(`parentRef contains "${escapeYqlString(parentRef)}"`);
  }

  // ReviewStatus filter
  if (reviewStatus) {
    conditions.push(`reviewStatus contains "${escapeYqlString(reviewStatus)}"`);
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
  caller: MemoryCaller,
): Promise<MemorySearchResult> {
  const { query, scope, limit = 20, offset = 0, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus , includeQuery = true, includeSummary = true, docId} = request;

  const yql = await buildMemoryYql({
    query,
    scope,
    caller,
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
      workspaceId: fields.workspaceId,
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
export async function insertMemory(
  doc: VespaMemoryDocument,
  workspaceId?: string,
): Promise<void> {
  // The tenant is always server-derived: either resolved by the caller from the request /
  // ingestion source, or from the owner (doc.userId is the owner's email or id). Never trust
  // a caller-supplied workspaceId/orgId on the document itself.
  doc.workspaceId = workspaceId || (await resolveMemoryWorkspaceId(doc.userId));
  delete doc.orgId;

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
    return getMemoryById(docId);
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

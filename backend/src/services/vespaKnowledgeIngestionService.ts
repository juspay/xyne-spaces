import { randomUUID } from 'crypto';
import removeMarkdown from 'remove-markdown';
import { logger } from '@/utils/logger';
import { searchMemory, insertMemory, deleteMemory } from './memoryService';
import { MemoryScope, VespaDocType, type VespaMemoryDocument } from '@/vespa/src/types';
import type { ConversationSourceAdapter } from './conversationIngestion/types';
import type { ExtractedSOP, ExtractedFACT } from './conversationAnalysisService';

const AGENT_NAME = 'conversation-analyst';
const MAX_CHUNK_SIZE = 5000; // Max characters per chatSummary chunk

/**
 * Chunk content into array for chatSummary field
 */
function chunkContent(content: string): string[] {
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
 * Get all existing memory documents for a session
 */
async function getAllDocumentsForSession(sessionId: string): Promise<VespaMemoryDocument[]> {
  const result = await searchMemory(
    {
      query: '',
      scope: MemoryScope.ALL,
      limit: 400,
      offset: 0,
      sessionId,
    },
    '',
  );
  return result.documents;
}

/**
 * Delete all memory documents for a session
 */
async function deleteAllForSession(sessionId: string): Promise<void> {
  const existingDocs = await getAllDocumentsForSession(sessionId);
  
  if (existingDocs.length === 0) {
    logger.info(`[VESPA-KNOWLEDGE] No existing documents to delete for session=${sessionId}`);
    return;
  }

  logger.info(`[VESPA-KNOWLEDGE] Deleting ${existingDocs.length} existing documents for session=${sessionId}`);
  
  for (const doc of existingDocs) {
    try {
      await deleteMemory(doc.docId);
    } catch (err) {
      logger.error(`[VESPA-KNOWLEDGE] Failed to delete doc ${doc.docId}:`, err);
    }
  }
  
  logger.info(`[VESPA-KNOWLEDGE] Deleted all existing documents for session=${sessionId}`);
}

export class VespaKnowledgeIngestionService {
  /**
   * Ingest all SOPs and Facts - completely replacing existing knowledge for this session
   */
  async ingestAll(
    adapter: ConversationSourceAdapter,
    sops: ExtractedSOP[],
    facts: ExtractedFACT[],
  ): Promise<void> {
    const ctx = await adapter.buildMemoryContext();
    const { sessionId, userId } = ctx;

    logger.info(`[VESPA-KNOWLEDGE] Starting ingestion for session=${sessionId}: ${sops.length} SOPs, ${facts.length} Facts`);

    // Step 1: Delete all existing knowledge for this session
    await deleteAllForSession(sessionId);

    // Step 2: Insert all new SOPs
    for (const sop of sops) {
      await this.insertNewSOP(sop, sessionId, userId);
    }

    // Step 3: Insert all new Facts
    for (const fact of facts) {
      await this.insertNewFACT(fact, sessionId, userId);
    }

    logger.info(`[VESPA-KNOWLEDGE] Completed ingestion for session=${sessionId}: ${sops.length} SOPs, ${facts.length} Facts`);
  }

  private async insertNewSOP(
    sop: ExtractedSOP,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const now = Date.now();
    const docId = randomUUID();
    const rawContent = sop.content;
    const chatSummary = chunkContent(removeMarkdown(rawContent));

    const doc: VespaMemoryDocument = {
      docId,
      docType: VespaDocType.SOP,
      userId,
      sessionId,
      repoUrl: sop.repoUrl ?? '',
      commitId: sop.commitId ?? '',
      ticketId: sop.ticketId ?? '',
      userQuery: sop.userQuery,
      tags: sop.tags,
      filePointers: sop.filePointers,
      rawContent,
      chatSummary,
      createdAt: now,
      updatedAt: now,
      committedAt: now,
      agentUsed: AGENT_NAME,
      modelUsed: [],
      parentRef: '',
      reviewStatus: 'pending',
    };

    await insertMemory(doc);
    logger.info(
      `[VESPA-KNOWLEDGE] Inserted SOP docId=${docId} userQuery="${sop.userQuery}" chunks=${chatSummary.length}`,
    );
  }

  private async insertNewFACT(
    fact: ExtractedFACT,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const now = Date.now();
    const docId = randomUUID();
    const rawContent = fact.content;
    const chatSummary = chunkContent(removeMarkdown(rawContent));

    const doc: VespaMemoryDocument = {
      docId,
      docType: VespaDocType.FACT,
      userId,
      sessionId,
      repoUrl: fact.repoUrl ?? '',
      commitId: fact.commitId ?? '',
      ticketId: fact.ticketId ?? '',
      userQuery: fact.userQuery,
      tags: fact.tags,
      filePointers: fact.filePointers,
      rawContent,
      chatSummary,
      createdAt: now,
      updatedAt: now,
      committedAt: now,
      agentUsed: AGENT_NAME,
      modelUsed: [],
      parentRef: '',
      reviewStatus: 'pending',
    };

    await insertMemory(doc);
    logger.info(
      `[VESPA-KNOWLEDGE] Inserted FACT docId=${docId} userQuery="${fact.userQuery}" chunks=${chatSummary.length}`,
    );
  }
}

export const vespaKnowledgeIngestionService = new VespaKnowledgeIngestionService();

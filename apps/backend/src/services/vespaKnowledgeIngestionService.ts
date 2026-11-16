import { randomUUID } from 'crypto';
import removeMarkdown from 'remove-markdown';
import { logger } from '@/utils/logger';
import { searchMemory, insertMemory, deleteMemory } from './memoryService';
import { MemoryScope, VespaDocType, type VespaMemoryDocument } from '@/vespa/src/types';

/** Memory entries formerly extracted by the retired conversation-analysis pipeline. */
export interface ExtractedSOP {
  userQuery: string;
  content: string;
  tags: string[];
  filePointers: string[];
  repoUrl?: string;
  commitId?: string;
  ticketId?: string;
}

export type ExtractedFACT = ExtractedSOP;

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

export interface ReplaceSessionDoc {
  docType: 'fact' | 'sop';
  rawContent: string;
  userQuery?: string;
  tags: string[];
  filePointers: string[];
  repoUrl: string;
  commitId: string;
  ticketId: string;
  reviewStatus?: 'pending' | 'verified' | 'rejected';
}

export class VespaKnowledgeIngestionService {
  /**
   * Publicly exposed helper — deletes all Vespa memory documents for a session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    await deleteAllForSession(sessionId);
  }

  /**
   * Replace all SOPs and Facts for a session atomically.
   * Deletes all existing docs for the session, then inserts the provided docs.
   * repoUrl/commitId/ticketId should be fetched by the caller from an existing doc.
   */
  async replaceSession(
    sessionId: string,
    userId: string,
    docs: ReplaceSessionDoc[],
  ): Promise<void> {
    logger.info(`[VESPA-KNOWLEDGE] replaceSession start session=${sessionId} docs=${docs.length}`);

    await deleteAllForSession(sessionId);

    const now = Date.now();
    for (const doc of docs) {
      const rawContent = doc.rawContent;
      const chatSummary = chunkContent(removeMarkdown(rawContent));
      const vespaDoc: VespaMemoryDocument = {
        docId:        randomUUID(),
        docType:      doc.docType === 'sop' ? VespaDocType.SOP : VespaDocType.FACT,
        userId,
        sessionId,
        repoUrl:      doc.repoUrl,
        commitId:     doc.commitId,
        ticketId:     doc.ticketId,
        userQuery:    doc.userQuery ?? '',
        tags:         doc.tags,
        filePointers: doc.filePointers,
        rawContent,
        chatSummary,
        createdAt:    now,
        updatedAt:    now,
        committedAt:  now,
        agentUsed:    AGENT_NAME,
        modelUsed:    [],
        parentRef:    '',
        reviewStatus: doc.reviewStatus ?? 'pending',
      };
      await insertMemory(vespaDoc);
      logger.info(`[VESPA-KNOWLEDGE] replaceSession inserted docId=${vespaDoc.docId} docType=${doc.docType}`);
    }

    logger.info(`[VESPA-KNOWLEDGE] replaceSession done session=${sessionId} inserted=${docs.length}`);
  }

    }

export const vespaKnowledgeIngestionService = new VespaKnowledgeIngestionService();

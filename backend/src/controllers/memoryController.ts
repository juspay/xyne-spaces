import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { searchMemory, getMemoryById, updateMemory, deleteMemory, insertMemory } from '@/services/memoryService';
import { VespaDocType, VespaMemoryDocument } from '@/vespa/src/types';
import { DatabaseClient } from '@/database/client';
import { redisService } from '@/services/redisService';
import { buildSessionRecordingKey, SESSION_RECORDING_KEYS_SET } from '@/utils/sessionRecordingKeys';

export interface SessionTurnPayload {
  sessionId: string;
  repoUrl: string;
  ticketId?: string;
  commitId?: string;
  agentUsed: string[];
  modelUsed: string[];
  messages: any[];
  startTime?: string;
}

/**
 * Controller for memory/knowledge base operations
 * Used by external services (e.g., Electron) to interact with Vespa memory schema
 */
export class MemoryController {
  /**
   * POST /api/memory/index
   * Index a new document in the memory schema
   */
  indexMemoryDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const document: VespaMemoryDocument = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Validate required fields
      if (!document.docId) {
        res.status(400).json({
          success: false,
          error: 'docId is required'
        });
        return;
      }

      // Get user from database to get email
      const prisma = DatabaseClient.getInstance();
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      // Replace document userId with user's email
      document.userId = user.email;
      logger.info('Indexing memory document', {
        docId: document.docId,
        userId: document.userId,
        docType: document.docType,
        sessionId: document.sessionId,
      });

      await insertMemory(document);

      logger.info('Memory document indexed successfully', {
        docId: document.docId,
      });

      res.status(200).json({
        success: true,
        docId: document.docId,
        message: 'Document indexed successfully',
      });
    } catch (error) {
      logger.error('Error indexing memory document', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to index document',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * POST /api/memory/search
   * Search documents in the memory schema
   */
  searchMemoryDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query, scope, limit, offset, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus, includeQuery, includeSummary, docId } = req.body;

      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      logger.info('Searching memory documents', {
        query: query?.substring(0, 100),
        scope,
        limit,
        offset,
      });

      const result = await searchMemory(
        { query, scope, limit, offset, docType, tags, repoUrl, commitId, sessionId, filePointers, ticketId, parentRef, reviewStatus, includeQuery, includeSummary , docId },
        userId,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error searching memory documents', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to search documents',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * GET /api/memory/:docId
   * Get a single document by docId
   */
  getMemoryDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const { docId } = req.params;

      if (!docId) {
        res.status(400).json({
          success: false,
          error: 'docId is required'
        });
        return;
      }

      logger.info('Getting memory document', { docId });

      const document = await getMemoryById(docId);

      if (!document) {
        res.status(404).json({
          success: false,
          error: 'Document not found',
          message: `No document found with docId: ${docId}`,
        });
        return;
      }

      logger.info('Memory document retrieved successfully', { docId });

      res.status(200).json({
        success: true,
        docId,
        data: document,
      });
    } catch (error) {
      logger.error('Error getting memory document', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get document',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * PATCH /api/memory/:docId
   * Update a memory document (partial update)
   */
  updateMemoryDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const { docId } = req.params;

      if (!docId) {
        res.status(400).json({
          success: false,
          error: 'docId is required'
        });
        return;
      }

      logger.info('Updating memory document', { docId });

      const updated = await updateMemory(docId, req.body);

      if (!updated) {
        res.status(404).json({
          success: false,
          error: 'Memory document not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      logger.error('Error updating memory document', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update document',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * DELETE /api/memory/:docId
   * Delete a memory document
   */
  deleteMemoryDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const { docId } = req.params;

      if (!docId) {
        res.status(400).json({
          success: false,
          error: 'docId is required'
        });
        return;
      }

      logger.info('Deleting memory document', { docId });

      await deleteMemory(docId);

      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting memory document', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to delete document',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * GET /api/memory/session/:sessionId
   * Get all documents by sessionId and optionally filter by docType
   */
  getMemoryDocumentsBySession = async (req: Request, res: Response): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const { docType } = req.query;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      if (!sessionId) {
        res.status(400).json({
          success: false,
          error: 'sessionId is required'
        });
        return;
      }

      logger.info('Getting memory documents by session', { sessionId, docType });

      const result = await searchMemory(
        {
          query: '',
          scope: 'all',
          limit: 50,
          offset: 0,
          sessionId,
          docType: docType as VespaDocType,
        },
        userId,
      );

      res.status(200).json({
        success: true,
        sessionId,
        docType: docType || null,
        count: result.documents.length,
        data: result,
      });
    } catch (error) {
      logger.error('Error getting memory documents by session', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get documents by session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * POST /api/memory/turn
   * Buffer session recording data in Redis.
   * Called by external services (e.g., CLI) to append messages to a session.
   */
  bufferSessionTurn = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload: SessionTurnPayload = req.body;

      // get userId since we have authenticated the user
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      if (!payload.sessionId) {
        res.status(400).json({ success: false, error: 'sessionId is required' });
        return;
      }

      if (!payload.messages || !Array.isArray(payload.messages)) {
        res.status(400).json({ success: false, error: 'messages array is required' });
        return;
      }

      const { sessionId } = payload;

      // Build Redis key
      const redisKey = buildSessionRecordingKey(sessionId);

      // Store batch with all session info needed for GCS reconstruction
      const batchData: Record<string, any> = {
        sessionId,
        userId,
        repoUrl: payload.repoUrl,
        agentUsed: payload.agentUsed,
        modelUsed: payload.modelUsed,
        timestamp: new Date().toISOString(),
        messages: payload.messages,
      };

      if (payload.ticketId) {
        batchData.ticketId = payload.ticketId;
      }
      if (payload.commitId) {
        batchData.commitId = payload.commitId;
      }

      // Push to Redis list, add to tracking set, and set TTL
      await redisService.rpush(redisKey, JSON.stringify(batchData));
      await redisService.sadd(SESSION_RECORDING_KEYS_SET, redisKey);
      await redisService.expire(redisKey, 86400); // 24h TTL

      logger.info('Session messages buffered in Redis', {
        sessionId,
        messageCount: payload.messages.length,
        redisKey,
      });

      res.status(200).json({
        success: true,
        sessionId,
        messageCount: payload.messages.length,
        message: 'Messages buffered in Redis.',
      });
    } catch (error) {
      logger.error('Error buffering session messages', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to buffer messages',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

// Export singleton instance
export const memoryController = new MemoryController();
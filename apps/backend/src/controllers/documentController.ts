import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { vespaKnowledgeIngestionService } from '@/services/vespaKnowledgeIngestionService';
import { searchMemory, deleteMemory } from '@/services/memoryService';
import { MemoryScope } from '@/vespa/src/types';

export class DocumentController {
  /**
   * DELETE /api/documents/sessions
   * Body: { sessionIds: string[] }
   * Deletes all Vespa memory documents for the given session IDs.
   */
  deleteBySessionIds = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { sessionIds } = req.body as { sessionIds: string[] };

      logger.info(`[DocumentController] deleteBySessionIds count=${sessionIds.length}`);

      await Promise.all(
        sessionIds.map((sessionId) =>
          vespaKnowledgeIngestionService.deleteSession(sessionId),
        ),
      );

      res.status(204).send();
    } catch (err) {
      logger.error('[DocumentController] deleteBySessionIds error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/documents/vespa-memory
   * Cleanup: deletes ALL documents from the Vespa memory schema (all users, all sessions).
   * Paginates until exhausted. CAUTION: irreversible.
   */
  cleanupAllVespaMemory = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      logger.warn(`[DocumentController] cleanupAllVespaMemory triggered by userId=${userId}`);

      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await searchMemory(
          {
            query: '',
            scope: MemoryScope.ALL,
            limit: 400,
            offset: 0,
          },
          '',
        );

        const docs = result.documents;
        if (docs.length === 0) {
          hasMore = false;
          break;
        }

        await Promise.all(docs.map((doc) => deleteMemory(doc.docId)));
        totalDeleted += docs.length;
        logger.info(`[DocumentController] cleanupAllVespaMemory deleted batch=${docs.length} total=${totalDeleted}`);

        // If fewer than 400 returned, we've reached the end
        if (docs.length < 400) {
          hasMore = false;
        }
      }

      logger.info(`[DocumentController] cleanupAllVespaMemory complete totalDeleted=${totalDeleted}`);
      res.status(204).send();
    } catch (err) {
      logger.error('[DocumentController] cleanupAllVespaMemory error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

export const documentController = new DocumentController();

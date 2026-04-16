import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { documentIngestQueue } from '@/queues/documentIngestQueue';
import { vespaKnowledgeIngestionService } from '@/services/vespaKnowledgeIngestionService';
import { searchMemory, deleteMemory } from '@/services/memoryService';
import { MemoryScope } from '@/vespa/src/types';
import { getStorageService } from '@/services/storage';

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);
const ALLOWED_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);
const MEMORY_DOCS_GCS_PREFIX = 'memoryDocuments';

function isAllowedFile(filename: string, mimetype: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(mimetype);
}

export class DocumentController {
  /**
   * POST /api/documents/upload
   * Upload one or more text/markdown files to be processed into Vespa memory.
   * Returns [ { filename, sessionId, status: 'queued' } ] for each accepted file.
   */
  uploadDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ success: false, error: 'No files uploaded' });
        return;
      }

      // Validate file types
      const rejected: string[] = [];
      const accepted: Express.Multer.File[] = [];
      for (const file of files) {
        if (isAllowedFile(file.originalname, file.mimetype)) {
          accepted.push(file);
        } else {
          rejected.push(file.originalname);
        }
      }

      if (accepted.length === 0) {
        res.status(400).json({
          success: false,
          error: `No valid files. Only .txt and .md files are supported. Rejected: ${rejected.join(', ')}`,
        });
        return;
      }

      // Look up user email (used as userId in Vespa)
      const prisma = DatabaseClient.getInstance();
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      const userEmail = user.email;

      const repoUrl = (req.body as Record<string, string>).repoUrl?.trim() ?? '';

      if (!repoUrl) {
        res.status(400).json({ success: false, error: 'repoUrl is required' });
        return;
      }

      const storageService = getStorageService(config.gcs.docsBucketName);
      const results: Array<{ filename: string; sessionId: string; status: string }> = [];

      for (const file of accepted) {
        const sessionId = randomUUID();
        const gcsPath = `${MEMORY_DOCS_GCS_PREFIX}/${userId}/${sessionId}/${file.originalname}`;
        const gcsUri = `gs://${config.gcs.docsBucketName}/${gcsPath}`;
        const repoUrl = (req.body as Record<string, string>).repoUrl ?? '';

        // Upload to GCS
        await storageService.uploadFileV2(file.buffer, {
          path: gcsPath,
          contentType: 'text/plain',
          metadata: {
            originalName: file.originalname,
            uploadedAt: new Date().toISOString(),
            userId,
            sessionId,
            repoUrl,
          },
        });

        logger.info(`[DocumentController] Uploaded file=${file.originalname} gcsUri=${gcsUri}`);

        // Enqueue ingestion job
        await documentIngestQueue.addJob({
          gcsUri,
          userId: userEmail,
          sessionId,
          originalFilename: file.originalname,
          repoUrl,
        });

        results.push({ filename: file.originalname, sessionId, status: 'queued' });
      }

      const response: Record<string, unknown> = { success: true, files: results };
      if (rejected.length > 0) {
        response.rejected = rejected;
        response.rejectedReason = 'Only .txt and .md files are supported';
      }

      res.status(200).json(response);
    } catch (err) {
      logger.error('[DocumentController] uploadDocuments error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

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

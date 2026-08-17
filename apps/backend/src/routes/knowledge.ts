import { AccessType } from '@xyne/shared';
import { Router, Request, Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import {
  approveKnowledgeCanvas,
  convertBlockNoteToMarkdown,
  getCanvasById,
} from '@/services/canvasService';
import { logger } from '@/utils/logger';

const router = Router();

/**
 * POST /api/knowledge/approve
 * Approve a knowledge canvas and create KnowledgeDocument entries
 *
 * Request body:
 * - canvasId: string (required) - The canonical canvas id
 * - viewAccessId: string (optional, legacy) - Accepted for backward
 *   compatibility with pre-XYNE-17290 clients. If provided (and canvasId
 *   isn't), the canvas is looked up and the canonical id is used.
 */
router.post('/approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { canvasId, viewAccessId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized - user not authenticated' });
      return;
    }

    if (!canvasId && !viewAccessId) {
      res.status(400).json({ error: 'canvasId is required' });
      return;
    }

    // Backward-compat resolution: if only the legacy viewAccessId was sent,
    // look up the canvas so downstream logic always sees the canonical id.
    let resolvedCanvasId: string = canvasId;
    if (!resolvedCanvasId && viewAccessId) {
      const canvas = await getCanvasById(viewAccessId);
      if (!canvas) {
        res.status(404).json({ error: 'Canvas not found' });
        return;
      }
      resolvedCanvasId = canvas.id;
    }

    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(400).json({ error: 'Missing workspaceId' });
      return;
    }

    const result = await approveKnowledgeCanvas(resolvedCanvasId, userId, workspaceId);

    if (!result.success) {
      // Non-owner approval attempts are rejected with 403.
      res.status(result.forbidden ? 403 : 400).json({ error: result.error });
      return;
    }

    if (result.alreadyApproved) {
      logger.info(`[Knowledge] Canvas ${resolvedCanvasId} was already approved`);
      res.status(200).json({
        success: true,
        alreadyApproved: true,
        message: 'Knowledge document was already approved',
      });
      return;
    }

    logger.info(`[Knowledge] User ${userId} approved canvas ${resolvedCanvasId}`);
    res.status(200).json({
      success: true,
      alreadyApproved: false,
      message: 'Knowledge document created successfully',
      documentIds: result.documentIds,
    });
  } catch (error) {
    logger.error('[Knowledge] Error approving canvas:', error);
    res.status(500).json({
      error: 'Failed to approve knowledge canvas',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/knowledge/documents
 * Get knowledge documents for the current project
 * 
 * Query params:
 * - projectId: string (required) - Filter by project
 * - repositoryUrl: string (optional) - Filter by repository
 * - limit: number (optional, default 50) - Max results
 * - offset: number (optional, default 0) - Pagination offset
 */
router.get('/documents', async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId, repositoryUrl, limit = '50', offset = '0' } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized - user not authenticated' });
      return;
    }

    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId query parameter is required' });
      return;
    }

    const prisma = DatabaseClient.getInstance();

    const listProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!listProject || listProject.workspaceId !== req.user?.workspaceId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        projectId,
        ...(repositoryUrl && typeof repositoryUrl === 'string' ? { repositoryUrl } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
    });

    const total = await prisma.knowledgeDocument.count({
      where: {
        projectId,
        ...(repositoryUrl && typeof repositoryUrl === 'string' ? { repositoryUrl } : {}),
      },
    });

    res.status(200).json({
      documents,
      total,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });
  } catch (error) {
    logger.error('[Knowledge] Error fetching documents:', error);
    res.status(500).json({
      error: 'Failed to fetch knowledge documents',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/knowledge/documents/:id
 * Get a specific knowledge document by ID
 */
router.get('/documents/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized - user not authenticated' });
      return;
    }

    const prisma = DatabaseClient.getInstance();

    const document = await prisma.knowledgeDocument.findUnique({
      where: { id },
    });

    if (!document) {
      res.status(404).json({ error: 'Knowledge document not found' });
      return;
    }

    const docProject = await prisma.project.findUnique({
      where: { id: document.projectId },
      select: { workspaceId: true },
    });
    if (!docProject || docProject.workspaceId !== req.user?.workspaceId) {
      res.status(404).json({ error: 'Knowledge document not found' });
      return;
    }

    res.status(200).json(document);
  } catch (error) {
    logger.error('[Knowledge] Error fetching document:', error);
    res.status(500).json({
      error: 'Failed to fetch knowledge document',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/knowledge/documents/:id
 * Delete a knowledge document
 */
router.delete('/documents/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized - user not authenticated' });
      return;
    }

    const prisma = DatabaseClient.getInstance();

    // Check if document exists
    const document = await prisma.knowledgeDocument.findUnique({
      where: { id },
    });

    if (!document) {
      res.status(404).json({ error: 'Knowledge document not found' });
      return;
    }

    // KnowledgeDocument has no createdBy of its own, so project ownership is the
    // authorization anchor.
    const docProject = await prisma.project.findUnique({
      where: { id: document.projectId },
      select: { workspaceId: true, createdBy: true },
    });
    if (!docProject || docProject.workspaceId !== req.user?.workspaceId) {
      res.status(404).json({ error: 'Knowledge document not found' });
      return;
    }
    // Deletion is allowed for the project's creator or a projects-admin (there is no
    // project-membership model; project administration is the LISTPROJECTS admin resource).
    let canDelete = docProject.createdBy === userId;
    if (!canDelete) {
      const projectsResource = await repositories.resources.findByName('LISTPROJECTS');
      canDelete = !!projectsResource &&
        (await repositories.resourceAccess.hasAccess(userId, projectsResource.id, AccessType.ADMIN));
    }
    if (!canDelete) {
      res.status(403).json({ error: 'Only the project owner or a projects admin can delete knowledge documents' });
      return;
    }

    // Delete the document
    await prisma.knowledgeDocument.delete({
      where: { id },
    });

    logger.info(`[Knowledge] User ${userId} deleted document ${id}`);
    res.status(200).json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    logger.error('[Knowledge] Error deleting document:', error);
    res.status(500).json({
      error: 'Failed to delete knowledge document',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/knowledge/convert
 * Convert BlockNote content to Markdown (utility endpoint)
 *
 * Request body:
 * - blocks: BlockNote JSON blocks array
 */
router.post('/convert', async (req: Request, res: Response): Promise<void> => {
  try {
    const { blocks } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized - user not authenticated' });
      return;
    }

    if (!blocks || !Array.isArray(blocks)) {
      res.status(400).json({ error: 'blocks array is required' });
      return;
    }

    const markdown = await convertBlockNoteToMarkdown(blocks);

    res.status(200).json({ markdown });
  } catch (error) {
    logger.error('[Knowledge] Error converting to markdown:', error);
    res.status(500).json({
      error: 'Failed to convert content',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

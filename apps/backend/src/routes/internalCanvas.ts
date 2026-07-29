import { Router, Request, Response, NextFunction } from 'express';
import { CanvasController } from '../controllers/canvasController.js';
import { validateS2SKey } from '../middleware/validateS2SKey.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';

const router = Router();
const messageAttachmentRepository = new MessageAttachmentRepository();
const canvasController = new CanvasController(messageAttachmentRepository);

/**
 * Extract the acting userId from x-user-id header and attach it to req.user
 * so the CanvasController can perform permission checks without modification.
 */
function attachInternalUser(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) {
    next(new Error('x-user-id header is required'));
    return;
  }
  (req as unknown as Record<string, unknown>).user = { id: userId };
  next();
}

router.get('/view/:canvasId', validateS2SKey, attachInternalUser, canvasController.readCanvas);
router.patch('/view/:canvasId', validateS2SKey, attachInternalUser, canvasController.updateCanvas);

export default router;
import { Router, Request, Response, NextFunction } from 'express';
import { CanvasController } from '../controllers/canvasController.js';
import { validateS2SKey } from '../middleware/validateS2SKey.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';
import { jwtService } from '../services/jwtService.js';

const router = Router();
const messageAttachmentRepository = new MessageAttachmentRepository();
const canvasController = new CanvasController(messageAttachmentRepository);

/**
 * Resolve the acting user from the caller's Xyne JWT (Authorization: Bearer)
 * and attach it to req.user so the CanvasController can perform permission
 * checks without modification. Callers here are already presenting a real
 * jwtService-signed token on every request (same one the browser uses) —
 * verifying it is strictly stronger than trusting a self-declared header.
 */
function attachInternalUser(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  if (!token) {
    next(new Error('Authorization bearer token is required'));
    return;
  }
  try {
    const decoded = jwtService.verifyToken(token);
    (req as unknown as Record<string, unknown>).user = {
      id: decoded.sub,
      workspaceId: decoded.workspaceId,
    };
    next();
  } catch (error) {
    next(error instanceof Error ? error : new Error('Invalid or expired token'));
  }
}

router.get('/view/:canvasId', validateS2SKey, attachInternalUser, canvasController.readCanvas);
router.patch('/view/:canvasId', validateS2SKey, attachInternalUser, canvasController.updateCanvas);

export default router;
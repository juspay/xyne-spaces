import { Router, Request, Response, NextFunction } from 'express';
import { CanvasController } from '../controllers/canvasController.js';
import { authenticateService } from '../claw/serviceAuth.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';

const router = Router();
const messageAttachmentRepository = new MessageAttachmentRepository();
const canvasController = new CanvasController(messageAttachmentRepository);

/**
 * A caller-named user (x-user-id) is not accepted: a service assertion proves
 * which service is calling, never which user. This route stays closed until its
 * caller sends a signed user token (an agent on-behalf-of token) instead.
 * TODO: switch the caller to /api/canvas with an on-behalf-of agent token.
 */
function attachInternalUser(_req: Request, res: Response, _next: NextFunction): void {
  res.status(403).json({ error: 'A signed user token is required; x-user-id is not accepted' });
}

const internalCaller = authenticateService('xyne-claw-auth', 'xyne-claw');

router.get('/view/:canvasId', internalCaller, attachInternalUser, canvasController.readCanvas);
router.patch('/view/:canvasId', internalCaller, attachInternalUser, canvasController.updateCanvas);

export default router;
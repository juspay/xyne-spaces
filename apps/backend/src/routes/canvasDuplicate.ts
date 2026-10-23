import express from 'express';
import { CanvasController } from '../controllers/canvasController.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';
import { canvasDuplicateLimiter } from '../middleware/rateLimiters';

/**
 * Kept apart from the canvas router, which is also mounted for installed apps
 * at /api/canvas/claw: duplicating copies stored files, so only a signed-in
 * user may start it.
 */
const router = express.Router();
const canvasController = new CanvasController(new MessageAttachmentRepository());

/**
 * @route POST /api/canvas/:canvasId/duplicate
 * @desc Copy a canvas, or one of its saved versions, into a new canvas owned by the caller
 * @access Private (requires user authentication)
 */
router.post('/:canvasId/duplicate', canvasDuplicateLimiter, canvasController.duplicateCanvas);

export default router;

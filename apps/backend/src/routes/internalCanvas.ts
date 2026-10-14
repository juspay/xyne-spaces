import { Router } from 'express';
import { CanvasController } from '../controllers/canvasController.js';
import { validateS2SKey } from '../middleware/validateS2SKey.js';
import { authenticateUserOrApp } from '../middleware/authenticateUserOrApp.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';

const router = Router();
const messageAttachmentRepository = new MessageAttachmentRepository();
const canvasController = new CanvasController(messageAttachmentRepository);

router.get('/view/:canvasId', validateS2SKey, authenticateUserOrApp, canvasController.readCanvas);
router.patch('/view/:canvasId', validateS2SKey, authenticateUserOrApp, canvasController.updateCanvas);

export default router;
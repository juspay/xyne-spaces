import express from 'express';
import { CanvasController } from '../controllers/canvasController.js';
import { uploadSingle } from '../middleware/upload.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';

const router = express.Router();
const messageAttachmentRepository = new MessageAttachmentRepository();
const canvasController = new CanvasController(messageAttachmentRepository);

router.post(
  '/upload',
  uploadSingle(),
  canvasController.uploadFile
);

router.get('/labels/suggestions', canvasController.getCanvasLabelSuggestions);

router.get('/labels', canvasController.getCanvasLabels);

router.post('/:canvasId/labels', canvasController.addCanvasLabel);

router.delete('/:canvasId/labels/:labelId', canvasController.removeCanvasLabel);

router.post(
  '/:canvasId/mentions',
  canvasController.handleMentions
);

router.post('/create', canvasController.createCanvas);

export default router;

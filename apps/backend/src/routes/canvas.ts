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

router.post(
  '/:canvasId/mentions',
  canvasController.handleMentions
);

router.post('/create', canvasController.createCanvas);

router.post('/:canvasId/request-access', canvasController.requestAccess);

router.get('/:canvasId/access-requests', canvasController.listAccessRequests);

router.get('/:canvasId/access-requests/mine', canvasController.myAccessRequestStatus);

router.post('/:canvasId/access-requests/:requesterId/resolve', canvasController.resolveAccessRequest);

export default router;

import express from 'express';
import { CanvasController } from '../controllers/canvasController.js';
import { uploadSingle } from '../middleware/upload.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';

const router = express.Router();
const messageAttachmentRepository = new MessageAttachmentRepository();
const canvasController = new CanvasController(messageAttachmentRepository);

router.post('/upload', uploadSingle(), canvasController.uploadFile);

router.post('/:canvasId/mentions', canvasController.handleMentions);

router.post('/:canvasId/request-edit-access', canvasController.requestEditAccess);

router.post('/create', canvasController.createCanvas);

export default router;

import { Router } from 'express';
import multer from 'multer';
import { EmailController } from '../controllers/emailController';
import { ZohoUploadController } from '../controllers/zohoUploadController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const emailController = new EmailController();
const zohoUploadController = new ZohoUploadController();

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Upload attachments to Zoho
router.post(
  '/:conversationId/upload-attachments',
  authMiddleware.authenticate,
  upload.array('files', 10),
  zohoUploadController.uploadAttachments
);

// Send email reply (REPLY or REPLY_ALL)
router.post('/:conversationId/reply', authMiddleware.authenticate, emailController.replyToEmail);

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { EmailController } from '../controllers/emailController';
import { ZohoUploadController } from '../controllers/zohoUploadController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const emailController = new EmailController();
const zohoUploadController = new ZohoUploadController();

// Email attachment limits — match Gmail's 25MB per-message ceiling.
const MAX_ATTACHMENT_FILES = 10;
const MAX_ATTACHMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB per file

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_FILE_SIZE_BYTES,
    files: MAX_ATTACHMENT_FILES,
  },
});

// Translate Multer's limit errors into actionable 400s the frontend can toast.
const handleAttachmentUploadErrors = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `Attachment exceeds the ${MAX_ATTACHMENT_FILE_SIZE_BYTES / (1024 * 1024)}MB per-file limit.`,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: `You can attach at most ${MAX_ATTACHMENT_FILES} files per email.`,
      });
    }
    return res.status(400).json({ error: err.message });
  }
  return next(err);
};

// Upload attachments for a reply (conversation-scoped)
router.post(
  '/:conversationId/upload-attachments',
  authMiddleware.authenticate,
  (req, res, next) =>
    upload.array('files', MAX_ATTACHMENT_FILES)(req, res, err =>
      handleAttachmentUploadErrors(err, req, res, next),
    ),
  zohoUploadController.uploadAttachments
);

// Upload attachments for compose (channel-scoped — no conversation yet)
router.post(
  '/channels/:channelId/upload-attachments',
  authMiddleware.authenticate,
  (req, res, next) =>
    upload.array('files', MAX_ATTACHMENT_FILES)(req, res, err =>
      handleAttachmentUploadErrors(err, req, res, next),
    ),
  zohoUploadController.uploadComposeAttachments,
);

// Send email reply (REPLY or REPLY_ALL)
router.post('/:conversationId/reply', authMiddleware.authenticate, emailController.replyToEmail);

// Initiate a brand-new outbound email from an email channel
router.post('/compose', authMiddleware.authenticate, emailController.composeEmail);

router.get(
  '/:channelId/contacts',
  authMiddleware.authenticate,
  emailController.listContacts,
);

router.get('/people', authMiddleware.authenticate, emailController.listPeople);
router.get(
  '/:channelId/people',
  authMiddleware.authenticate,
  emailController.listPeople,
);

// List Claw agents added to this channel (for the auto-draft agent picker)
router.get(
  '/:channelId/claw-agents',
  authMiddleware.authenticate,
  emailController.listClawAgents,
);

// On-demand auto-draft reasoning + tool calls (read-through to claw; not stored)
router.get(
  '/:conversationId/autodraft-insight',
  authMiddleware.authenticate,
  emailController.getAutoDraftInsight,
);


export default router;

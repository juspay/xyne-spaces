import { Router } from 'express';
import { DraftAttachmentController } from '../controllers/draftAttachmentController';
import { authMiddleware } from '../middleware/auth';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const draftAttachmentController = new DraftAttachmentController();

/**
 * POST /api/drafts/attachments/upload
 * Upload multiple file attachments for a draft message
 * 
 * Request body (multipart/form-data):
 * - file: Files to upload (array)
 * - attachmentIds: Array of MessageAttachment IDs (created by mutator), JSON string
 * - channelId: ID of the channel
 * - conversationId: (Optional) ID of the conversation
 * - draftMessageId: ID of the draft message
 * - width: (Optional legacy) Single width value
 * - height: (Optional legacy) Single height value
 * - fileMetadata: (Optional) JSON string array with metadata for each file
 *   Format: [{ fileIndex: number, hasThumbnail: boolean, width?: number, height?: number }]
 * - thumbnail: (Optional) Thumbnail files (array)
 * 
 * Response:
 * - 200: Returns array of upload results with success/error status for each file
 * - 400: Bad request (missing parameters)
 * - 401: Unauthorized
 * - 500: Server error
 */
router.post(
  '/attachments/upload',
  authMiddleware.authenticate,
  uploadMultiple,
  draftAttachmentController.uploadDraftAttachment.bind(draftAttachmentController)
);

export default router;

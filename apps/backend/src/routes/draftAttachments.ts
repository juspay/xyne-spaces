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
 * - 400: Bad request (missing parameters, or the per-draft attachment limit exceeded)
 * - 401: Unauthorized
 * - 500: Server error
 */
router.post(
  '/attachments/upload',
  authMiddleware.authenticate,
  uploadMultiple,
  draftAttachmentController.uploadDraftAttachment.bind(draftAttachmentController)
);

/**
 * POST /api/drafts/attachments/reorder
 * Persist a new display order for a draft's attachments by restamping the
 * stored `position` (0-based, request order — first id renders leftmost).
 *
 * Request body (JSON):
 * - attachmentIds: Ordered array of MessageAttachment IDs (the complete new order)
 * - channelId: ID of the channel the draft belongs to (authorization scope)
 * - conversationId: (Optional) ID of the conversation the draft belongs to
 *
 * Response:
 * - 200: { success: true, reorderedCount: number }
 * - 400: Bad request (missing/invalid parameters)
 * - 401: Unauthorized
 * - 403: Caller is not a channel participant or does not own every referenced attachment
 * - 404: No draft for this user/channel/conversation
 * - 500: Server error
 */
router.post(
  '/attachments/reorder',
  authMiddleware.authenticate,
  draftAttachmentController.reorderDraftAttachments.bind(draftAttachmentController)
);

export default router;

import { Router } from 'express';
import { DraftAttachmentController } from '../controllers/draftAttachmentController';
import { ComposeDraftController } from '../controllers/composeDraftController';
import { authMiddleware } from '../middleware/auth';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const draftAttachmentController = new DraftAttachmentController();
const composeDraftController = new ComposeDraftController();

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

/**
 * POST /api/drafts/compose
 * Owner-scoped upsert of a compose-DM draft (placeholder `composedm-<uuid>` channel).
 * Persists the draft body + sorted recipient user ids so unsent compose DMs survive
 * reload and appear in Drafts & Sent (Slack parity). Auth is applied at the mount
 * (`/api/drafts` → authMiddleware.authenticate in app.ts); body is Zod-validated
 * in the controller; identity comes from the session.
 */
router.post('/compose', composeDraftController.upsertComposeDraft.bind(composeDraftController));

/**
 * POST /api/drafts/compose/attachments  (multipart/form-data)
 * Persist attachments for a compose-DM draft, owner-scoped, idempotent by attachment id.
 * Fields: files[], attachmentIds (JSON string[]), draftId, channelId, recipientIds (JSON).
 */
router.post(
  '/compose/attachments',
  uploadMultiple,
  composeDraftController.uploadComposeDraftAttachment.bind(composeDraftController),
);

/**
 * DELETE /api/drafts/compose/attachments/:attachmentId
 * Delete a single compose-DM draft attachment. Owner-scoped + DRAFT-only.
 */
router.delete(
  '/compose/attachments/:attachmentId',
  composeDraftController.deleteComposeDraftAttachment.bind(composeDraftController),
);

/**
 * DELETE /api/drafts/compose/:draftId
 * Delete a compose-DM draft row when content is cleared. Owner-scoped; refuses to
 * delete if the draft still has attachments (clears content instead).
 */
router.delete(
  '/compose/:draftId',
  composeDraftController.deleteComposeDraft.bind(composeDraftController),
);

export default router;

import express from 'express';
import { linkPreviewController } from '../controllers/linkPreviewController';

const router = express.Router();

/**
 * @route POST /api/link-preview
 * @desc Fetch link preview metadata for a URL
 * @access Private (requires authentication)
 */
router.post('/', linkPreviewController.fetchPreview.bind(linkPreviewController));

export default router;

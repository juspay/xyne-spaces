import express from 'express';
import { searchFeedbackController } from '@/controllers/searchFeedbackController';

const router = express.Router();

/**
 * @route POST /api/search-feedback
 * @desc Post search feedback from Cmd+K or the search results page
 * @access Private (requires authentication)
 */
router.post('/', searchFeedbackController.submit.bind(searchFeedbackController));

/**
 * @route GET /api/search-feedback/target
 * @desc Channel and group the feedback will be posted to, for display in the form
 * @access Private (requires authentication)
 */
router.get('/target', searchFeedbackController.target.bind(searchFeedbackController));

export default router;

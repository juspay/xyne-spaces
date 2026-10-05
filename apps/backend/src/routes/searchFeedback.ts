import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { searchFeedbackController } from '@/controllers/searchFeedbackController';

const router = express.Router();

/**
 * Per-user limit on posting feedback. Each post @-mentions the whole search group, so a
 * script or a stuck key must not be able to flood them.
 */
const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: {
    success: false,
    error: 'Too many feedback posts. Please wait a minute and try again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @route POST /api/search-feedback
 * @desc Post search feedback from Cmd+K or the search results page
 * @access Private (requires authentication)
 */
router.post('/', submitLimiter, searchFeedbackController.submit.bind(searchFeedbackController));

/**
 * @route GET /api/search-feedback/target
 * @desc Channel and group the feedback will be posted to, for display in the form
 * @access Private (requires authentication)
 */
router.get('/target', searchFeedbackController.target.bind(searchFeedbackController));

export default router;

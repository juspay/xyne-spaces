/**
 * Routes for AI-powered features
 * All AI-related endpoints are defined here
 */

import express from 'express';
import {
  generateTitleFromCanvasContent,
  generateTitleFromDescription,
  rewriteEmail,
} from '../controllers/aiController.js';
import { aiTitleLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

// Note: Authentication middleware is applied at the app level

/**
 * POST /api/ai/generate-title
 * Generate a title from a description
 */
router.post('/generate-title', generateTitleFromDescription);

router.post('/generate-canvas-title', aiTitleLimiter, generateTitleFromCanvasContent);

/**
 * POST /api/ai/rewrite-email
 * Rewrite email text based on an action or custom instruction
 */
router.post('/rewrite-email', rewriteEmail);

export default router;

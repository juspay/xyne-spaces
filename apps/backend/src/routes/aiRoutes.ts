/**
 * Routes for AI-powered features
 * All AI-related endpoints are defined here
 */

import express from 'express';
import { generateTitleFromDescription, rewriteEmail } from '../controllers/aiController.js';

const router = express.Router();

// Note: Authentication middleware is applied at the app level

/**
 * POST /api/ai/generate-title
 * Generate a title from a description
 */
router.post('/generate-title', generateTitleFromDescription);

/**
 * POST /api/ai/rewrite-email
 * Rewrite email text based on an action or custom instruction
 */
router.post('/rewrite-email', rewriteEmail);

export default router;

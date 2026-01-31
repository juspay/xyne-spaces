import express from 'express';
import { TestAuthController } from '@/controllers/testAuthController';

const router = express.Router();

/**
 * Test Authentication Routes
 * 
 * These routes are ONLY available when NODE_ENV=test.
 * They provide test-only authentication that bypasses Google OAuth.
 * 
 * @security These routes should NEVER be registered in production!
 */

const testAuthController = new TestAuthController();

router.post('/auth/login', testAuthController.testLogin);
router.post('/auth/logout', testAuthController.testLogout);

export default router;

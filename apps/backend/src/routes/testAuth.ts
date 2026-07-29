import express from 'express';
import { TestAuthController } from '@/controllers/testAuthController';
import { TestFixturesController } from '@/controllers/testFixturesController';

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
const testFixturesController = new TestFixturesController();

router.post('/auth/login', testAuthController.testLogin);
router.post('/auth/logout', testAuthController.testLogout);
router.post('/fixtures/channel-participants', testFixturesController.addChannelParticipants);

export default router;

import express from 'express';
import { TestAuthController } from '@/controllers/testAuthController';
import { TestFixturesController } from '@/controllers/testFixturesController';
import { TestDeskFixturesController } from '@/controllers/testDeskFixturesController';

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
const testDeskFixturesController = new TestDeskFixturesController();

router.post('/auth/login', testAuthController.testLogin);
router.post('/auth/logout', testAuthController.testLogout);
router.post('/fixtures/channel-participants', testFixturesController.addChannelParticipants);
router.post('/fixtures/desk/channel-mailbox', testDeskFixturesController.connectChannelMailbox);
router.post('/fixtures/desk/gmail-delivery', testDeskFixturesController.deliverGmailMessages);
router.get('/fixtures/desk/outbox', testDeskFixturesController.listOutbox);

export default router;

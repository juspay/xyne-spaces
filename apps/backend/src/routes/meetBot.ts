/**
 * Callbacks from the Xyne Automatic Meet notetaker bot (apps/meet-bot).
 * Authenticated with the shared MEET_BOT_API_KEY, not a user session.
 */
import { Router } from 'express';
import { meetNotetakerController, verifyMeetBot } from '@/controllers/meetNotetakerController';

const router = Router();

router.post('/sessions/:callId/status', verifyMeetBot, meetNotetakerController.botStatus);
router.post('/sessions/:callId/livekit', verifyMeetBot, meetNotetakerController.botLivekit);

export default router;

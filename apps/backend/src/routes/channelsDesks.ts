import { Router } from 'express';
import { channelsDeskController } from '../controllers/channelsDeskController';

const router = Router();

router.get('/:channelId', channelsDeskController.get); // Which app feeds a Channels desk
router.get('/:channelId/channels', channelsDeskController.listChannels); // The app's channels on it, and addable ones
router.post('/:channelId/channels', channelsDeskController.addChannel);
router.delete('/:channelId/channels/:sourceChannelId', channelsDeskController.removeChannel);

export default router;

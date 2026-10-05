import { Router } from 'express';
import { hubDeskController } from '../controllers/hubDeskController';

const router = Router();

router.get('/:channelId', hubDeskController.get); // Which app feeds a HUB desk
router.get('/:channelId/channels', hubDeskController.listChannels); // The app's channels on it, and addable ones
router.post('/:channelId/channels', hubDeskController.addChannel);
router.delete('/:channelId/channels/:sourceChannelId', hubDeskController.removeChannel);

export default router;

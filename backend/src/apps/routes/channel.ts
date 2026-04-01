import { Router } from 'express';
import { ChannelController } from '../controllers/channelController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';

const router = Router();
const channelController = new ChannelController();

// Channel routes
router.post('/info', validateChannelAccessForPost, channelController.getChannelByName);

export default router;